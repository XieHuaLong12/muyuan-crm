import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor } from '@/lib/auth';
import { saveCustomer, duplicates } from './customer-service';
import { mapLeadFields, type LeadField } from '@/lib/meta-lead-fields';

/**
 * Meta Facebook Lead Ads 接入
 *
 * 流程：Meta 推送 leadgen → 校验签名 → Graph API 取详情 → 映射 CRM 字段
 *       → 按 leadgenId 去重 → 关联或创建客户（阶段 NEW）
 *
 * 两道防线：
 *   1. X-Hub-Signature-256（HMAC SHA256，用 META_APP_SECRET）——防伪造推送
 *   2. MetaLeadEvent.leadgenId 唯一约束 —— 防 Meta 重复推送造成重复客户
 */

const DAY = 86_400_000;
const CLAIM_TIMEOUT_MS = 5 * 60_000;

function safeReason(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  return (token ? message.replaceAll(token, '[redacted]') : message).slice(0, 2000);
}

/** Graph API 版本走配置，不硬编码：Meta 每约两年废弃一次版本号。 */
export function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v26.0';
}

/**
 * R2：校验 Meta 的 X-Hub-Signature-256。
 * 用原始请求体做 HMAC，任何解析后的对象都不行 —— 必须传 raw body。
 */
export function verifyMetaSignature(rawBody: string, header: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return { ok: false, reason: 'META_APP_SECRET 未配置' } as const;
  if (!header) return { ok: false, reason: '缺少 x-hub-signature-256 请求头' } as const;

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(header, 'utf8');
  // 长度不等时 timingSafeEqual 会抛错，先比长度
  if (a.length !== b.length) return { ok: false, reason: '签名不匹配' } as const;
  return timingSafeEqual(a, b) ? ({ ok: true } as const) : ({ ok: false, reason: '签名不匹配' } as const);
}

/** Meta Lead Ads webhook 推送体 */
const webhookPayload = z.object({
  object: z.string().optional(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      time: z.number().optional(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.unknown(),
        }),
      ).default([]),
    }),
  ).default([]),
});

const leadgenValue = z.object({
  leadgen_id: z.string().min(1),
  page_id: z.string().optional(),
  form_id: z.string().optional(),
  created_time: z.union([z.number(), z.string()]).optional(),
  ad_id: z.string().optional(),
  adgroup_id: z.string().optional(),
});

export type LeadgenEvent = { leadgenId: string; pageId: string; formId: string };

/** RECEIVED is pending work, not a completed import. Only completed states can be skipped. */
export function shouldSkipProcessedLead(status: string): boolean {
  return status === 'CREATED' || status === 'LINKED';
}

/** 从推送体里取出所有 leadgen 事件（一次推送可能带多条）。 */
export function extractLeadgenEvents(body: unknown): LeadgenEvent[] {
  const parsed = webhookPayload.parse(body);
  const out: LeadgenEvent[] = [];
  for (const entry of parsed.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'leadgen') continue;
      const value = leadgenValue.parse(change.value);
      out.push({
        leadgenId: value.leadgen_id,
        pageId: value.page_id || entry.id || '',
        formId: value.form_id || '',
      });
    }
  }
  return out;
}

const graphLead = z.object({
  id: z.string(),
  created_time: z.string().optional(),
  // 广告归因：线索来自哪条广告 / 哪个广告系列（用于对账广告花费与线索）
  ad_id: z.string().optional(),
  adset_id: z.string().optional(),
  campaign_id: z.string().optional(),
  field_data: z.array(
    z.object({
      name: z.string().default(''),
      values: z.array(z.string()).default([]),
    }),
  ).default([]),
});

/**
 * 调用 Graph API 取线索详情。
 * 失败时返回错误原因而不是抛异常 —— 调用方要把失败落库，便于排查。
 */
export async function fetchLead(leadgenId: string) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return { ok: false as const, error: 'META_PAGE_ACCESS_TOKEN 未配置' };

  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set('fields', 'id,created_time,field_data,form_id,ad_id,adset_id,campaign_id');

  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token}` } });
    const text = await response.text();
    if (!response.ok) {
      let graphCode: number | undefined;
      let graphSubcode: number | undefined;
      let graphMessage = '请求失败';
      try {
        const responseError = JSON.parse(text) as { error?: { code?: number; error_subcode?: number; message?: string } };
        graphCode = responseError.error?.code;
        graphSubcode = responseError.error?.error_subcode;
        graphMessage = responseError.error?.message || graphMessage;
      } catch { /* Non-JSON error response: HTTP status remains diagnostic. */ }
      const error = safeReason(`Graph API HTTP ${response.status}${graphCode === undefined ? '' : ` code ${graphCode}`}${graphSubcode === undefined ? '' : ` subcode ${graphSubcode}`}: ${graphMessage}`);
      return { ok: false as const, error, httpStatus: response.status, graphCode };
    }
    const parsed = graphLead.safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false as const, error: `Graph API HTTP ${response.status}: 返回格式异常` };
    return { ok: true as const, lead: parsed.data, raw: text };
  } catch (error) {
    return { ok: false as const, error: `Graph API 请求失败: ${safeReason(error)}` };
  }
}

/** 取第一个管理员作为线索负责人（与其他自动建客户的地方保持一致）。 */
async function defaultActor(): Promise<Actor> {
  const owner = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true, name: true, email: true, role: true } });
  return owner;
}

async function mark(id: string, claimedAt: Date, status: 'FAILED' | 'LINKED', customerId: string | null, error = '', attribution?: { adId: string | null; campaignId: string | null; rawPayload: Prisma.InputJsonValue }) {
  const result = await db.metaLeadEvent.updateMany({
    where: { leadgenId: id, status: 'PROCESSING', processingStartedAt: claimedAt },
    data: { ...attribution, status, customerId, error: safeReason(error), processingStartedAt: null },
  });
  if (result.count !== 1) throw new Error('Meta lead processing claim expired');
}

/**
 * 处理单条 leadgen 事件：去重 → 取详情 → 关联或创建客户。
 *
 * 返回结构用于日志与测试；任何一步失败都会把原因写进 MetaLeadEvent.error。
 */
export async function handleLeadgenEvent(event: LeadgenEvent, payload: unknown, requestId?: string) {
  // 幂等：同一个 leadgenId 已经处理过就直接返回，避免 Meta 重推造成重复客户
  const existing = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: event.leadgenId }, select: { status: true, customerId: true } });
  if (existing && shouldSkipProcessedLead(existing.status)) {
    return { leadgenId: event.leadgenId, status: 'SKIPPED' as const, customerId: existing.customerId, reason: '已处理过该 leadgen_id' };
  }

  const claimedAt = new Date();
  const claim = await db.metaLeadEvent.updateMany({
    where: {
      leadgenId: event.leadgenId,
      OR: [
        { status: { in: ['RECEIVED', 'FAILED'] } },
        { status: 'PROCESSING', processingStartedAt: { lt: new Date(claimedAt.getTime() - CLAIM_TIMEOUT_MS) } },
      ],
    },
    data: { status: 'PROCESSING', processingStartedAt: claimedAt, error: '', pageId: event.pageId, formId: event.formId },
  });
  if (claim.count !== 1) {
    const current = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: event.leadgenId }, select: { status: true, customerId: true } });
    if (shouldSkipProcessedLead(current.status)) return { leadgenId: event.leadgenId, status: 'SKIPPED' as const, customerId: current.customerId, reason: '已处理过该 leadgen_id' };
    return { leadgenId: event.leadgenId, status: 'FAILED' as const, customerId: null, reason: '同一 leadgen_id 正在处理，稍后重试' };
  }

  try {
    const lead = await fetchLead(event.leadgenId);
    if (!lead.ok) {
      console.error('[meta-lead] graph api failed', { requestId, leadgenId: event.leadgenId, httpStatus: lead.httpStatus, graphCode: lead.graphCode });
      await mark(event.leadgenId, claimedAt, 'FAILED', null, lead.error);
      return { leadgenId: event.leadgenId, status: 'FAILED' as const, customerId: null, reason: lead.error };
    }
    console.info('[meta-lead] lead fetched', { requestId, leadgenId: event.leadgenId });

    const fields: LeadField[] = lead.lead.field_data.flatMap(item =>
      item.values.map(value => ({ name: item.name, label: item.name, value })),
    );
    const mapped = mapLeadFields(fields, { leadgenId: event.leadgenId, formId: event.formId });
    const actor = await defaultActor();
    const matched = await duplicates({ email: mapped.email, phone: mapped.phone, whatsapp: mapped.whatsapp });
    const attribution = { adId: lead.lead.ad_id ?? null, campaignId: lead.lead.campaign_id ?? null, rawPayload: { webhook: payload, lead: JSON.parse(lead.raw) } as Prisma.InputJsonValue };
    if (matched.length) {
      await mark(event.leadgenId, claimedAt, 'LINKED', matched[0].id, '', attribution);
      console.info('[meta-lead] customer linked', { requestId, leadgenId: event.leadgenId, customerId: matched[0].id });
      return { leadgenId: event.leadgenId, status: 'LINKED' as const, customerId: matched[0].id, reason: '' };
    }

    const created = await saveCustomer(
      {
        name: mapped.name,
        companyName: mapped.companyName,
        country: mapped.country,
        phone: mapped.phone,
        whatsapp: mapped.whatsapp,
        email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mapped.email) ? mapped.email : '',
        source: 'FACEBOOK',
        sourceDetail: 'Facebook Ads',
        purchaseType: mapped.purchaseType,
        productInterest: mapped.productInterest,
        quantity: mapped.quantity,
        notes: mapped.notes,
        stage: 'NEW',
        ownerId: actor.id,
      },
      actor,
      undefined,
      async (tx, customerId) => {
        const updated = await tx.metaLeadEvent.updateMany({
          where: { leadgenId: event.leadgenId, status: 'PROCESSING', processingStartedAt: claimedAt },
          data: { ...attribution, status: 'CREATED', customerId, error: '', processingStartedAt: null },
        });
        if (updated.count !== 1) throw new Error('Meta lead processing claim expired');
      },
    );
    console.info('[meta-lead] customer created', { requestId, leadgenId: event.leadgenId, customerId: created.id });
    return { leadgenId: event.leadgenId, status: 'CREATED' as const, customerId: created.id, reason: '' };
  } catch (error) {
    const reason = safeReason(error);
    console.error('[meta-lead] customer processing failed', { requestId, leadgenId: event.leadgenId, errorType: error instanceof Error ? error.name : 'unknown' });
    await mark(event.leadgenId, claimedAt, 'FAILED', null, reason);
    return { leadgenId: event.leadgenId, status: 'FAILED' as const, customerId: null, reason };
  }
}

/** 先登记，再等待处理完成才 ACK；Graph 或数据库失败由 Meta 重试。 */
export async function handleWebhookPayload(body: unknown, requestId?: string) {
  let events: LeadgenEvent[];
  try {
    events = extractLeadgenEvents(body);
  } catch (error) {
    return { accepted: 0, results: [], error: error instanceof Error ? error.message : String(error) };
  }
  console.info('[meta-lead] payload parsed', { requestId, accepted: events.length });
  if (!events.length) return { accepted: 0, results: [], error: '' };

  // 登记事件（此时还没有客户），保证即使后续失败也留有痕迹
  for (const event of events) {
    await db.metaLeadEvent.upsert({
      where: { leadgenId: event.leadgenId },
      create: { leadgenId: event.leadgenId, pageId: event.pageId, formId: event.formId, rawPayload: body as Prisma.InputJsonValue, error: '' },
      update: {},
    });
  }

  // Await processing before ACK: detached promises can be terminated after the HTTP response
  // on short-lived hosting runtimes. Meta can retry a failed request; completed leads are idempotent.
  const results = [];
  for (const event of events) {
    results.push(await handleLeadgenEvent(event, body, requestId));
  }

  const failures = results.filter(result => result.status === 'FAILED');
  return {
    accepted: events.length,
    results,
    error: failures.length ? `${failures.length} leadgen event(s) failed; see MetaLeadEvent.error` : '',
  };
}

/** 供测试与排查：读取最近的 Meta 线索事件。 */
export async function recentMetaLeadEvents(limit = 20) {
  return db.metaLeadEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    select: { id: true, leadgenId: true, formId: true, status: true, error: true, customerId: true, createdAt: true },
  });
}

export { DAY };
