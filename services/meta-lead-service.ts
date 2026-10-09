import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,HttpError } from '@/lib/auth';
import { canonicalEmail, canonicalPhone, metaLeadKey, sourceInstant } from '@/lib/contact-identity';
import { lockIdentity, resolveContact, rememberCustomerContacts, recordLeadAttribution } from './contact-identity-service';
import { retryTransaction } from '@/lib/transaction-retry';
import { mapLeadFields, type LeadField } from '@/lib/meta-lead-fields';
import { AD_LEAD_FRESH_HOURS } from '@/lib/constants';
import { fetchLeadAdSnapshot } from './meta-lead-ad-snapshot';

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
  if (value instanceof Prisma.PrismaClientKnownRequestError) {
    const column = typeof value.meta?.column_name === 'string' ? ` column ${value.meta.column_name}` : '';
    return `Prisma ${value.code}${column}`;
  }
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
  ad_name: z.string().optional(),
  adset_name: z.string().optional(),
  campaign_name: z.string().optional(),
  form_id: z.string().optional(),
  platform: z.string().optional(),
  field_data: z.array(
    z.object({
      name: z.string().default(''),
      values: z.array(z.string()).default([]),
    }),
  ).default([]),
});

export type GraphLead = z.infer<typeof graphLead>;
/** Validates one lead row returned by GET /{form_id}/leads (same shape as the single-lead read). */
export function parseGraphLead(row: unknown) {
  const parsed = graphLead.safeParse(row);
  return parsed.success ? parsed.data : null;
}
export const GRAPH_LEAD_FIELDS = 'id,created_time,field_data,form_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform';

/** Leads made by Meta's Lead Ads Testing Tool carry placeholders such as "<test lead: dummy data for email>". */
export const TEST_LEAD_NOTE = 'Meta 线索测试工具生成的占位数据，没有真实联系方式；能看到这条说明接入已打通';
export function isTestLead(lead: { field_data: { values: string[] }[] }) {
  return lead.field_data.some(field => field.values.some(value => /test lead|dummy data/i.test(value)));
}

/** Failures caused by the lead's own data need a person; everything else is retried automatically. */
export function needsHuman(error: string) {
  return /AMBIGUOUS|缺少可确认|回收站/.test(error);
}
/** 1, 2, 4 … minutes between automatic retries, capped at one hour. */
export function retryDelayMs(attempts: number) {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

/**
 * 调用 Graph API 取线索详情。
 * 失败时返回错误原因而不是抛异常 —— 调用方要把失败落库，便于排查。
 */
export async function fetchLead(leadgenId: string) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return { ok: false as const, error: 'META_PAGE_ACCESS_TOKEN 未配置' };

  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set('fields', GRAPH_LEAD_FIELDS);

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

/** 收件管理员：自动线索的操作人；负责人由分配规则在事务内决定（待分配池或轮流分配）。 */
async function defaultActor(): Promise<Actor> {
  return (await import('./lead-assignment-service')).intakeAdmin();
}

async function mark(id: string, claimedAt: Date, status: 'FAILED' | 'LINKED', customerId: string | null, error = '', attribution?: { adId: string | null; campaignId: string | null; rawPayload: Prisma.InputJsonValue }) {
  const reason = safeReason(error);
  const current = await db.metaLeadEvent.findUnique({ where: { leadgenId: id }, select: { attempts: true } });
  const attempts = (current?.attempts ?? 0) + (status === 'FAILED' ? 1 : 0);
  const result = await db.metaLeadEvent.updateMany({
    where: { leadgenId: id, status: 'PROCESSING', processingStartedAt: claimedAt },
    data: { ...attribution, status, customerId, error: reason, processingStartedAt: null, attempts,
      nextAttemptAt: status === 'FAILED' && !needsHuman(reason) ? new Date(Date.now() + retryDelayMs(attempts)) : null },
  });
  if (result.count !== 1) throw new Error('Meta lead processing claim expired');
}

/**
 * 处理单条 leadgen 事件：去重 → 取详情 → 关联或创建客户。
 *
 * 返回结构用于日志与测试；任何一步失败都会把原因写进 MetaLeadEvent.error。
 */
export async function handleLeadgenEvent(event: LeadgenEvent, payload: unknown, requestId?: string, options: { prefetched?: { lead: GraphLead; raw: string } } = {}) {
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
    // The form poll already holds the full lead; the webhook and retries read it from Graph.
    const lead = options.prefetched ? { ok: true as const, ...options.prefetched } : await fetchLead(event.leadgenId);
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
    if(lead.lead.id!==event.leadgenId)throw new Error('Graph lead ID 与请求不一致');
    const occurredAt=sourceInstant(lead.lead.created_time);
    const candidatePhones=[canonicalPhone(mapped.whatsapp,undefined,true),canonicalPhone(mapped.phone,undefined,true)].filter((p):p is string=>!!p);
    const phoneE164=candidatePhones[0]||null;
    const emailNormalized=canonicalEmail(mapped.email);
    const [adSnapshot,formSnapshot]=await Promise.all([fetchLeadAdSnapshot(lead.lead.ad_id),db.metaLeadForm.findUnique({where:{formId:lead.lead.form_id||event.formId||''},select:{name:true}})]);
    const attribution={adId:lead.lead.ad_id??null,campaignId:lead.lead.campaign_id??null,rawPayload:{webhook:payload,lead:JSON.parse(lead.raw)} as Prisma.InputJsonValue};
    return await retryTransaction(()=>db.$transaction(async tx=>{
      await lockIdentity(tx);
      const resolved=await resolveContact({leadId:event.leadgenId,phones:candidatePhones,email:mapped.email},tx);
      let customerId:string|null=resolved.status==='MATCHED'?resolved.customerId:null;
      let status:'CREATED'|'LINKED'|'FAILED'=customerId?'LINKED':'FAILED';
      if(customerId){
        const active=await tx.customer.findUniqueOrThrow({where:{id:customerId},select:{deletedAt:true}});
        if(active.deletedAt)throw new Error('该留资关联回收站客户，请人工恢复后重试');
      }
      const assignment=await import('./lead-assignment-service');
      let intake:Awaited<ReturnType<typeof assignment.resolveIntakeOwner>>|null=null;
      if(resolved.status==='UNMATCHED'&&(phoneE164||emailNormalized)){
        const settings=await tx.setting.findUniqueOrThrow({where:{id:'system'}});
        intake=await assignment.resolveIntakeOwner(tx);
        const customer=await tx.customer.create({data:{name:mapped.name,companyName:mapped.companyName,country:mapped.country,
          phone:mapped.phone,whatsapp:mapped.whatsapp,whatsappNormalized:phoneE164?.slice(1)||'',email:emailNormalized||'',
          source:['ig','instagram'].includes(lead.lead.platform?.toLowerCase()??'')?'INSTAGRAM':'FACEBOOK',sourceDetail:lead.lead.ad_name||'Facebook Ads',purchaseType:mapped.purchaseType,productInterest:mapped.productInterest,
          quantity:mapped.quantity,notes:mapped.notes,stage:'NEW',stageSource:'SYSTEM',ownerId:intake.ownerId,currency:settings.currency,inquiryAt:occurredAt}});
        customerId=customer.id;status='CREATED';
        await tx.stageHistory.create({data:{customerId,toStage:'NEW',changedBy:actor.id,note:'Meta Lead webhook'}});
      }
      await recordLeadAttribution(tx,{leadKey:metaLeadKey(event.leadgenId),leadId:event.leadgenId,customerId,status:customerId?'MATCHED':resolved.status,
        matchMethod:customerId?(status==='CREATED'?'CREATED':resolved.method):resolved.method,confidence:customerId?100:0,
        occurredAt,phoneRaw:mapped.whatsapp||mapped.phone,phoneE164,emailNormalized,platform:lead.lead.platform||null,
        accountId:adSnapshot?.account_id||null,campaignId:lead.lead.campaign_id||adSnapshot?.campaign_id||null,campaignName:lead.lead.campaign_name||adSnapshot?.campaign?.name||null,adsetId:lead.lead.adset_id||adSnapshot?.adset_id||null,adsetName:lead.lead.adset_name||adSnapshot?.adset?.name||null,
        adId:lead.lead.ad_id||null,adName:lead.lead.ad_name||adSnapshot?.name||null,creativeId:adSnapshot?.creative?.id||null,creativeName:adSnapshot?.creative?.name||null,formId:lead.lead.form_id||event.formId||null,formName:formSnapshot?.name||null,source:'WEBHOOK',answers:JSON.parse(lead.raw)},
        [mapped.phone,mapped.whatsapp].flatMap(raw=>{const normalized=canonicalPhone(raw,undefined,true);return normalized?[{raw,normalized}]:[];}));
      let repeatSubmission=false;
      if(customerId){
        await rememberCustomerContacts(tx,customerId,'META_WEBHOOK');
        const submission=await tx.leadSubmission.findUnique({where:{eventKey:metaLeadKey(event.leadgenId)}});
        if(!submission){const previous=await tx.leadSubmission.aggregate({where:{customerId},_max:{ordinal:true}});
          await tx.leadSubmission.create({data:{customerId,eventKey:metaLeadKey(event.leadgenId),leadId:event.leadgenId,ordinal:(previous._max.ordinal||0)+1,
            occurredAt:occurredAt||new Date(),values:JSON.stringify(mapped),raw:lead.raw,filename:options.prefetched?'Meta 定时补拉':'Meta webhook',fileHash:'',translationPending:'[]'}});
          // A backfilled old submission is recorded but does not ask the owner to call within minutes.
          repeatSubmission=status==='LINKED'&&(!occurredAt||Date.now()-occurredAt.getTime()<AD_LEAD_FRESH_HOURS*3600_000);}
      }
      // Assignment runs after the lead ledger exists, so a fresh ad lead gets the short first-contact deadline.
      if(status==='CREATED'&&customerId&&intake)await assignment.enterIntake(tx,customerId,actor.id,intake,'Meta 线索表单');
      if(repeatSubmission&&customerId)await assignment.flagRepeatSubmission(tx,customerId,{leadKey:event.leadgenId,formName:formSnapshot?.name||null,adName:lead.lead.ad_name||adSnapshot?.name||null},actor.id);
      const reason=customerId?'':resolved.status==='AMBIGUOUS'?'AMBIGUOUS：联系方式对应多个客户，等待人工认领'
        :isTestLead(lead.lead)?`缺少可确认的手机号或邮箱：${TEST_LEAD_NOTE}`:'缺少可确认的手机号或邮箱，等待人工认领';
      const updated=await tx.metaLeadEvent.updateMany({where:{leadgenId:event.leadgenId,status:'PROCESSING',processingStartedAt:claimedAt},
        data:{...attribution,status,customerId,error:reason,processingStartedAt:null,metaCreatedAt:occurredAt,nextAttemptAt:null}});
      if(updated.count!==1)throw new Error('Meta lead processing claim expired');
      return {leadgenId:event.leadgenId,status,customerId,reason};
    }));
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

  if(results.some(r=>r.customerId))try{await (await import('./identity-chain-service')).reconcilePendingIdentityMessages({limit:50},await defaultActor());}catch{console.error('[meta-lead] conversation reconciliation remains pending');}
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

/** Recover persisted failures even after a provider's retry window has ended. */
export async function retryPendingMetaLeads(input:unknown,user:Actor){
  if(user.role!=='ADMIN')throw new HttpError(403,'留资重试需要管理员权限');
  const {limit}=z.object({limit:z.coerce.number().int().min(1).max(50).default(3)}).parse(input);
  if(!process.env.META_PAGE_ACCESS_TOKEN)return {status:'NOT_CONNECTED',succeeded:0,failed:0};
  const rows=await db.metaLeadEvent.findMany({where:{OR:[{status:'RECEIVED'},{status:'FAILED',NOT:[{error:{contains:'AMBIGUOUS'}},{error:{contains:'缺少可确认'}},{error:{contains:'回收站'}}]},{status:'PROCESSING',processingStartedAt:{lt:new Date(Date.now()-CLAIM_TIMEOUT_MS)}}]},orderBy:{createdAt:'asc'},take:limit});
  const job=await db.syncJob.create({data:{provider:'META',jobType:'LEAD_RETRY',status:'RUNNING',actorId:user.id}});
  let succeeded=0,failed=0;
  for(const row of rows)try{const result=await handleLeadgenEvent({leadgenId:row.leadgenId,pageId:row.pageId,formId:row.formId},row.rawPayload);if(result.status==='FAILED')failed++;else succeeded++;}catch{failed++;}
  await db.syncJob.update({where:{id:job.id},data:{status:failed?'PARTIAL':'OK',completedAt:new Date(),processed:rows.length,succeeded,failed,error:failed?'LEAD_RETRY_FAILED':null}});
  return {status:'CONNECTED',succeeded,failed};
}

/**
 * Scheduled retry honouring each event's back-off. Also picks up webhook registrations that never
 * finished (the request died after RECEIVED) and stale processing claims.
 */
export async function retryDueMetaLeads(limit=20){
  if(!process.env.META_PAGE_ACCESS_TOKEN)return {status:'NOT_CONNECTED' as const,succeeded:0,failed:0};
  const now=new Date();
  const rows=await db.metaLeadEvent.findMany({where:{OR:[
    {status:'RECEIVED',createdAt:{lt:new Date(now.getTime()-2*60_000)}},
    {status:'FAILED',OR:[{nextAttemptAt:{lte:now}},{nextAttemptAt:null,attempts:0}],NOT:[{error:{contains:'AMBIGUOUS'}},{error:{contains:'缺少可确认'}},{error:{contains:'回收站'}}]},
    {status:'PROCESSING',processingStartedAt:{lt:new Date(now.getTime()-CLAIM_TIMEOUT_MS)}},
  ]},orderBy:{createdAt:'asc'},take:limit});
  let succeeded=0,failed=0;
  for(const row of rows){
    try{const result=await handleLeadgenEvent({leadgenId:row.leadgenId,pageId:row.pageId,formId:row.formId},row.rawPayload);if(result.status==='FAILED')failed++;else succeeded++;}
    catch{failed++;}
  }
  return {status:'CONNECTED' as const,succeeded,failed};
}

export { DAY };
