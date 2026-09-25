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
          value: z.object({
            leadgen_id: z.string().min(1),
            page_id: z.string().default(''),
            form_id: z.string().default(''),
            created_time: z.number().optional(),
            ad_id: z.string().optional(),
            adgroup_id: z.string().optional(),
          }),
        }),
      ).default([]),
    }),
  ).default([]),
});

export type LeadgenEvent = { leadgenId: string; pageId: string; formId: string };

/** 从推送体里取出所有 leadgen 事件（一次推送可能带多条）。 */
export function extractLeadgenEvents(body: unknown): LeadgenEvent[] {
  const parsed = webhookPayload.parse(body);
  const out: LeadgenEvent[] = [];
  for (const entry of parsed.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'leadgen') continue;
      out.push({
        leadgenId: change.value.leadgen_id,
        pageId: change.value.page_id || entry.id || '',
        formId: change.value.form_id || '',
      });
    }
  }
  return out;
}

const graphLead = z.object({
  id: z.string(),
  created_time: z.string().optional(),
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
  url.searchParams.set('access_token', token);
  url.searchParams.set('fields', 'id,created_time,field_data,form_id,ad_id,adset_id,campaign_id');

  try {
    const response = await fetch(url, { cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false as const, error: `Graph API ${response.status}: ${text.slice(0, 300)}` };
    }
    const parsed = graphLead.safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false as const, error: `Graph API 返回格式异常: ${parsed.error.message.slice(0, 200)}` };
    return { ok: true as const, lead: parsed.data, raw: text };
  } catch (error) {
    return { ok: false as const, error: `Graph API 请求失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 取第一个管理员作为线索负责人（与其他自动建客户的地方保持一致）。 */
async function defaultActor(): Promise<Actor> {
  const owner = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true, name: true, email: true, role: true } });
  return owner;
}

async function mark(id: string, status: string, customerId: string | null, error = '') {
  await db.metaLeadEvent.update({
    where: { leadgenId: id },
    data: { status, customerId, error: error.slice(0, 2000) },
  }).catch(() => undefined);
}

/**
 * 处理单条 leadgen 事件：去重 → 取详情 → 关联或创建客户。
 *
 * 返回结构用于日志与测试；任何一步失败都会把原因写进 MetaLeadEvent.error。
 */
export async function handleLeadgenEvent(event: LeadgenEvent, payload: unknown) {
  // 幂等：同一个 leadgenId 已经处理过就直接返回，避免 Meta 重推造成重复客户
  const existing = await db.metaLeadEvent.findUnique({ where: { leadgenId: event.leadgenId }, select: { id: true, status: true, customerId: true } });
  if (existing && existing.status !== 'FAILED') {
    return { leadgenId: event.leadgenId, status: 'SKIPPED' as const, customerId: existing.customerId, reason: '已处理过该 leadgen_id' };
  }

  const record = existing
    ? await db.metaLeadEvent.update({ where: { leadgenId: event.leadgenId }, data: { status: 'RECEIVED', error: '', pageId: event.pageId, formId: event.formId } })
    : await db.metaLeadEvent.create({ data: { leadgenId: event.leadgenId, pageId: event.pageId, formId: event.formId, rawPayload: payload as Prisma.InputJsonValue, error: '' } });

  const lead = await fetchLead(event.leadgenId);
  if (!lead.ok) {
    await mark(event.leadgenId, 'FAILED', null, lead.error);
    return { leadgenId: event.leadgenId, status: 'FAILED' as const, customerId: null, reason: lead.error };
  }

  const fields: LeadField[] = lead.lead.field_data.flatMap(item =>
    item.values.map(value => ({ name: item.name, label: item.name, value })),
  );
  const mapped = mapLeadFields(fields, { leadgenId: event.leadgenId, formId: event.formId });
  const actor = await defaultActor();

  // 已有同邮箱/同电话的客户 → 关联而不新建（需求第六步）
  const matched = await duplicates({ email: mapped.email, phone: mapped.phone, whatsapp: mapped.whatsapp });
  if (matched.length) {
    await mark(event.leadgenId, 'LINKED', matched[0].id);
    return { leadgenId: event.leadgenId, status: 'LINKED' as const, customerId: matched[0].id, reason: '已有相同邮箱或电话的客户，已关联而不重复创建' };
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
  );

  await mark(event.leadgenId, 'CREATED', created.id);
  await db.metaLeadEvent.update({ where: { id: record.id }, data: { rawPayload: { webhook: payload, lead: JSON.parse(lead.raw) } as Prisma.InputJsonValue } });
  return { leadgenId: event.leadgenId, status: 'CREATED' as const, customerId: created.id, reason: '' };
}

/**
 * 处理整包推送。Meta 要求 200 尽快返回，因此这里**串行但后台化**：
 * 先把事件登记进 MetaLeadEvent，再异步处理详情，避免 Graph API 慢导致 Meta 重试。
 */
export async function handleWebhookPayload(body: unknown) {
  let events: LeadgenEvent[];
  try {
    events = extractLeadgenEvents(body);
  } catch (error) {
    return { accepted: 0, results: [], error: error instanceof Error ? error.message : String(error) };
  }
  if (!events.length) return { accepted: 0, results: [], error: '' };

  // 登记事件（此时还没有客户），保证即使后续失败也留有痕迹
  for (const event of events) {
    const exists = await db.metaLeadEvent.findUnique({ where: { leadgenId: event.leadgenId }, select: { id: true } });
    if (!exists) {
      await db.metaLeadEvent.create({
        data: { leadgenId: event.leadgenId, pageId: event.pageId, formId: event.formId, rawPayload: body as Prisma.InputJsonValue, error: '' },
      });
    }
  }

  // 后台执行，不阻塞 webhook 响应
  void Promise.all(
    events.map(event =>
      handleLeadgenEvent(event, body).catch(async error => {
        await mark(event.leadgenId, 'FAILED', null, error instanceof Error ? error.message : String(error));
      }),
    ),
  ).catch(() => undefined);

  return { accepted: events.length, results: [], error: '' };
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
