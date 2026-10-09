import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { dayKey, localDate } from '@/lib/time';
import { graphGet, graphPost, pagedGraphGet } from '@/lib/meta-graph';
import { sourceInstant } from '@/lib/contact-identity';
import { GRAPH_LEAD_FIELDS, handleLeadgenEvent, needsHuman, parseGraphLead, retryDueMetaLeads, shouldSkipProcessedLead } from './meta-lead-service';
import { formsEnv, syncLeadForms } from './meta-form-service';

/**
 * Meta 广告线索实时入库的兜底与体检。
 *
 * Webhook 是主通道（几秒入库）。只要 Meta 侧配置出问题（主页没订阅应用、Token 过期、
 * 应用未上线），推送就会静默丢失。这里按表单定时补拉「上次之后提交的线索」，与 Webhook
 * 走同一个入库函数，按 leadgen_id 幂等；并把接入状态汇总给管理员。
 */

const OVERLAP_MS = 10 * 60_000;
const FIRST_WINDOW_MS = 48 * 3600_000;
const MAX_DAYS = 90;
const FORM_REFRESH_MS = 60 * 60_000;
export const POLL_STALE_MS = 20 * 60_000;

type PollResult = {
  status: 'CONNECTED' | 'NOT_CONNECTED';
  forms: number; fetched: number; recovered: number; retried: number; alreadyImported: number; failed: number;
  errors: { formId: string; error: string }[];
};

/** Forms to poll: active forms in the catalogue plus any form that produced a lead in the last 30 days. */
async function pollableForms() {
  const catalogue = await db.metaLeadForm.findMany({ where: { status: 'ACTIVE' }, select: { formId: true, pageId: true, pollWatermark: true } });
  const known = new Set(catalogue.map(f => f.formId));
  const recent = await db.metaLeadEvent.groupBy({ by: ['formId', 'pageId'], where: { formId: { not: '' }, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } });
  const extra = recent.filter(r => !known.has(r.formId)).map(r => ({ formId: r.formId, pageId: r.pageId, pollWatermark: null as Date | null }));
  return [...catalogue, ...extra];
}

/**
 * Pulls leads submitted since each form's watermark (minus a 10-minute overlap) and imports the ones the
 * webhook did not deliver. `days` re-scans a fixed window instead (manual catch-up, at most 90 days,
 * which is how long Meta keeps leads).
 */
export async function pollMetaLeads(input: { days?: number } = {}): Promise<PollResult> {
  const { token, pageId } = formsEnv();
  const empty: PollResult = { status: 'NOT_CONNECTED', forms: 0, fetched: 0, recovered: 0, retried: 0, alreadyImported: 0, failed: 0, errors: [] };
  if (!token) return empty;
  if (pageId) {
    const lastForms = await db.metaSyncRun.findFirst({ where: { kind: 'FORMS', status: 'OK' }, orderBy: { startedAt: 'desc' } });
    if (!lastForms || Date.now() - lastForms.startedAt.getTime() > FORM_REFRESH_MS) {
      try { await syncLeadForms(); } catch { /* The poll still runs with the forms already known. */ }
    }
  }
  const forms = await pollableForms();
  const job = await db.syncJob.create({ data: { provider: 'META', jobType: 'LEAD_POLL', status: 'RUNNING' } });
  const result: PollResult = { ...empty, status: 'CONNECTED', forms: forms.length };
  const now = Date.now();
  for (const form of forms) {
    const since = input.days
      ? now - Math.min(input.days, MAX_DAYS) * 86400_000
      : form.pollWatermark ? form.pollWatermark.getTime() - OVERLAP_MS : now - FIRST_WINDOW_MS;
    const page = await pagedGraphGet<unknown>(`${form.formId}/leads`, token, {
      fields: GRAPH_LEAD_FIELDS,
      limit: '100',
      filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since / 1000) }]),
    });
    if (page.error) result.errors.push({ formId: form.formId, error: page.error });
    let watermark = form.pollWatermark?.getTime() ?? 0;
    for (const row of page.rows) {
      const lead = parseGraphLead(row);
      if (!lead) continue;
      result.fetched++;
      const createdAt = sourceInstant(lead.created_time)?.getTime() ?? 0;
      if (createdAt > watermark) watermark = createdAt;
      const existing = await db.metaLeadEvent.findUnique({ where: { leadgenId: lead.id }, select: { status: true, rawPayload: true } });
      if (existing && shouldSkipProcessedLead(existing.status)) { result.alreadyImported++; continue; }
      const event = { leadgenId: lead.id, pageId: pageId || form.pageId, formId: lead.form_id || form.formId };
      const payload = existing?.rawPayload ?? { source: 'POLL', formId: event.formId, leadgenId: lead.id };
      if (!existing) {
        await db.metaLeadEvent.upsert({
          where: { leadgenId: lead.id },
          create: { ...event, receivedVia: 'POLL', rawPayload: payload, error: '', metaCreatedAt: createdAt ? new Date(createdAt) : null },
          update: {},
        });
      }
      const outcome = await handleLeadgenEvent(event, payload, undefined, { prefetched: { lead, raw: JSON.stringify(row) } });
      if (outcome.status === 'CREATED' || outcome.status === 'LINKED') { if (existing) result.retried++; else result.recovered++; }
      else if (outcome.status === 'SKIPPED' || outcome.reason.includes('正在处理')) result.alreadyImported++;
      else result.failed++;
    }
    // Only move the watermark forward when the whole window was read.
    await db.metaLeadForm.updateMany({ where: { formId: form.formId }, data: {
      polledAt: new Date(), ...(!page.error && watermark ? { pollWatermark: new Date(watermark) } : {}),
    } });
  }
  await db.syncJob.update({ where: { id: job.id }, data: {
    status: result.errors.length || result.failed ? 'PARTIAL' : 'OK', completedAt: new Date(),
    processed: result.fetched, succeeded: result.recovered + result.retried, failed: result.failed,
    error: result.errors.length ? result.errors.map(e => `${e.formId}: ${e.error}`).join('; ').slice(0, 2000) : null,
    detail: { forms: result.forms, recovered: result.recovered, retried: result.retried, alreadyImported: result.alreadyImported, days: input.days ?? null },
  } });
  return result;
}

/** Scheduled job: catch up on undelivered leads, then retry failures whose back-off has elapsed. */
export async function runLeadIntakeJob() {
  const poll = await pollMetaLeads();
  const retry = await retryDueMetaLeads(20);
  return { poll, retry };
}

type SubscribedApp = { id?: string; name?: string; subscribed_fields?: string[] };

async function pageSubscription(token: string, pageId: string) {
  const appId = process.env.META_APP_ID?.trim();
  const result = await graphGet<{ data?: SubscribedApp[] }>(`${pageId}/subscribed_apps`, token, { fields: 'id,name,subscribed_fields' });
  if (!result.ok) return { ok: false as const, error: result.error };
  const apps = result.data.data ?? [];
  const app = appId ? apps.find(a => a.id === appId) : apps.length === 1 ? apps[0] : undefined;
  return { ok: true as const, appFound: !!app, leadgen: !!app?.subscribed_fields?.includes('leadgen'), fields: app?.subscribed_fields ?? [], appName: app?.name ?? null };
}

/** Subscribes the Page to this app's leadgen webhook, keeping fields that were already subscribed. */
export async function subscribePageToLeadgen(user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '需要管理员权限');
  const { token, pageId, missing } = formsEnv();
  if (!token || !pageId) throw new HttpError(400, `缺少 ${missing.join('、')}`);
  const current = await pageSubscription(token, pageId);
  const fields = new Set(current.ok ? current.fields : []);
  fields.add('leadgen');
  const result = await graphPost<{ success?: boolean }>(`${pageId}/subscribed_apps`, token, { subscribed_fields: [...fields].join(',') });
  if (!result.ok) throw new HttpError(502, `订阅失败：${result.error}。请确认主页 Token 拥有 pages_manage_metadata 权限。`);
  return { subscribed: result.data.success !== false, fields: [...fields] };
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/** Everything an administrator needs to trust that ad leads arrive in time, plus what to fix if not. */
export async function metaLeadHealth(user: Actor, options: { live?: boolean } = {}) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '需要管理员权限');
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const now = new Date();
  const todayStart = localDate(`${dayKey(now, settings.timezone)}T00:00`, settings.timezone);
  const dayAgo = new Date(now.getTime() - 86400_000), weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const env = {
    META_APP_SECRET: !!process.env.META_APP_SECRET,
    META_LEAD_WEBHOOK_SECRET: !!(process.env.META_LEAD_WEBHOOK_SECRET?.trim() || process.env.META_LEAD_VERIFY_TOKEN?.trim()),
    META_PAGE_ACCESS_TOKEN: !!process.env.META_PAGE_ACCESS_TOKEN?.trim(),
    META_PAGE_ID: !!process.env.META_PAGE_ID?.trim(),
    META_APP_ID: !!process.env.META_APP_ID?.trim(),
    META_SYNC_SECRET: !!process.env.META_SYNC_SECRET?.trim(),
  };
  const [lastWebhook, lastPoll, today, recovered24h, humanRows, humanCount, retrying, latestFailure, latencyRows, pool, oldestPool, forms, formCounts] = await Promise.all([
    db.metaLeadEvent.findFirst({ where: { receivedVia: 'WEBHOOK' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.syncJob.findFirst({ where: { provider: 'META', jobType: 'LEAD_POLL' }, orderBy: { startedAt: 'desc' } }),
    db.metaLeadEvent.groupBy({ by: ['status', 'receivedVia'], where: { createdAt: { gte: todayStart } }, _count: { _all: true } }),
    db.metaLeadEvent.count({ where: { receivedVia: 'POLL', createdAt: { gte: dayAgo } } }),
    db.metaLeadEvent.findMany({ where: { status: 'FAILED', OR: [{ error: { contains: 'AMBIGUOUS' } }, { error: { contains: '缺少可确认' } }, { error: { contains: '回收站' } }] },
      orderBy: { createdAt: 'desc' }, take: 20, select: { leadgenId: true, formId: true, error: true, createdAt: true } }),
    db.metaLeadEvent.count({ where: { status: 'FAILED', OR: [{ error: { contains: 'AMBIGUOUS' } }, { error: { contains: '缺少可确认' } }, { error: { contains: '回收站' } }] } }),
    db.metaLeadEvent.count({ where: { status: { in: ['FAILED', 'RECEIVED'] }, NOT: [{ error: { contains: 'AMBIGUOUS' } }, { error: { contains: '缺少可确认' } }, { error: { contains: '回收站' } }] } }),
    db.metaLeadEvent.findFirst({ where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, select: { error: true, createdAt: true } }),
    db.metaLeadEvent.findMany({ where: { status: { in: ['CREATED', 'LINKED'] }, metaCreatedAt: { not: null }, createdAt: { gte: weekAgo } }, select: { createdAt: true, metaCreatedAt: true } }),
    db.customer.count({ where: { deletedAt: null, pendingAssignment: true } }),
    db.customer.findFirst({ where: { deletedAt: null, pendingAssignment: true }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.metaLeadForm.findMany({ where: { status: 'ACTIVE' }, orderBy: { leadsCount: 'desc' }, take: 20, select: { formId: true, name: true, leadsCount: true, polledAt: true, pollWatermark: true } }),
    db.metaLeadEvent.groupBy({ by: ['formId'], where: { status: { in: ['CREATED', 'LINKED'] } }, _count: { _all: true } }),
  ]);
  const count = (filter: (row: (typeof today)[number]) => boolean) => today.filter(filter).reduce((n, row) => n + row._count._all, 0);
  const latencies = latencyRows.map(r => Math.max(0, (r.createdAt.getTime() - r.metaCreatedAt!.getTime()) / 1000));
  let live: null | { token: { ok: boolean; pageName?: string; pageMatches?: boolean; error?: string }; subscription: Awaited<ReturnType<typeof pageSubscription>> | null } = null;
  const { token, pageId } = formsEnv();
  if (options.live && token) {
    const me = await graphGet<{ id?: string; name?: string }>('me', token, { fields: 'id,name' });
    live = {
      token: me.ok ? { ok: true, pageName: me.data.name, pageMatches: !pageId || me.data.id === pageId } : { ok: false, error: me.error },
      subscription: pageId ? await pageSubscription(token, pageId) : null,
    };
  }
  const alerts: string[] = [];
  const missing = Object.entries(env).filter(([key, ok]) => !ok && key !== 'META_APP_ID').map(([key]) => key);
  if (missing.length) alerts.push(`缺少环境变量：${missing.join('、')}`);
  if (!lastPoll || now.getTime() - lastPoll.startedAt.getTime() > POLL_STALE_MS) alerts.push('定时补拉没有在运行：请在 Hostinger 定时任务中每 5 分钟调用 /api/cron/meta-leads');
  if (recovered24h) alerts.push(`最近 24 小时有 ${recovered24h} 条线索是定时补拉补回的，Webhook 可能没有送达，请做一次连接检测`);
  if (latestFailure && /TOKEN_EXPIRED|code 190/.test(latestFailure.error)) alerts.push('主页 Token 已失效，线索无法读取，请更换 META_PAGE_ACCESS_TOKEN');
  if (humanCount) alerts.push(`${humanCount} 条线索缺少联系方式或匹配到多个客户，需要人工认领`);
  if (live?.token.ok === false) alerts.push('主页 Token 无法使用，请检查是否过期或被撤销');
  if (live?.token.pageMatches === false) alerts.push('META_PAGE_ACCESS_TOKEN 不属于 META_PAGE_ID 对应的主页');
  if (live?.subscription && live.subscription.ok && !live.subscription.leadgen) alerts.push('Facebook 主页没有为本应用订阅 leadgen，Webhook 不会推送；可点击「订阅 leadgen」');
  const byForm = new Map(formCounts.map(row => [row.formId, row._count._all]));
  return {
    env, alerts, live,
    adLeadFirstContactMinutes: settings.adLeadFirstContactMinutes,
    lastWebhookAt: lastWebhook?.createdAt.toISOString() ?? null,
    lastPoll: lastPoll ? { at: lastPoll.startedAt.toISOString(), status: lastPoll.status, detail: lastPoll.detail, error: lastPoll.error } : null,
    today: {
      received: count(() => true),
      viaWebhook: count(r => r.receivedVia === 'WEBHOOK'),
      viaPoll: count(r => r.receivedVia === 'POLL'),
      created: count(r => r.status === 'CREATED'),
      linked: count(r => r.status === 'LINKED'),
      failed: count(r => r.status === 'FAILED'),
    },
    retrying,
    needsHuman: { total: humanCount, rows: humanRows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), retryable: !needsHuman(r.error) })) },
    latencySeconds: { p50: percentile(latencies, 0.5), p90: percentile(latencies, 0.9), samples: latencies.length },
    pool: { count: pool, oldestAt: oldestPool?.createdAt.toISOString() ?? null },
    forms: forms.map(f => ({ ...f, crmLeads: byForm.get(f.formId) ?? 0, polledAt: f.polledAt?.toISOString() ?? null, pollWatermark: f.pollWatermark?.toISOString() ?? null })),
  };
}
export type MetaLeadHealth = Awaited<ReturnType<typeof metaLeadHealth>>;
