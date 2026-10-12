import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope, requireAdmin } from '@/lib/auth';
import { graphVersion } from '@/lib/meta-graph';
import { canonicalPhone, canonicalEmail } from '@/lib/contact-identity';
import { retryTransaction } from '@/lib/transaction-retry';

export function feedbackConnection() {
  return process.env.META_FEEDBACK_ENABLED === 'true' && !!process.env.META_DATASET_ID?.trim() && !!process.env.META_CAPI_ACCESS_TOKEN?.trim();
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function enqueueFeedback(tx: Prisma.TransactionClient, input: {
  eventId: string; eventName: string; customerId: string; eventTime: Date; orderId?: string; leadKey?: string | null;
  value?: Prisma.Decimal; currency?: string;
}) {
  const customer = await tx.customer.findUniqueOrThrow({ where: { id: input.customerId }, select: { phoneE164: true, emailNormalized: true, phone: true, whatsapp: true, countryCode: true, email: true } });
  const lead = input.leadKey ? await tx.customerLeadAttribution.findUnique({where:{leadKey:input.leadKey},select:{phoneE164:true,emailNormalized:true}}) : null;
  const phone = lead?.phoneE164 || customer.phoneE164 || canonicalPhone(customer.phone,customer.countryCode) || canonicalPhone(customer.whatsapp,undefined,true);
  const email = lead?.emailNormalized || customer.emailNormalized || canonicalEmail(customer.email);
  const leadId = input.leadKey?.startsWith('meta:') ? input.leadKey.slice(5) : null;
  const payload = { event_name: input.eventName === 'LeadQualified' ? 'QualifiedLead' : input.eventName,
    event_id: input.eventId, event_time: Math.floor(input.eventTime.getTime() / 1000), action_source: 'system_generated',
    user_data: { ...(leadId ? { lead_id: leadId } : {}), ...(phone ? { ph: [sha(phone.slice(1))] } : {}),
      ...(email ? { em: [sha(email)] } : {}) },
    custom_data: { ...(input.value ? { value: Number(input.value.toFixed(2)), currency: input.currency } : {}),
      ...(input.orderId ? { order_id: input.orderId } : {}) } };
  return tx.advertisingFeedback.upsert({ where: { eventId: input.eventId }, create: { ...input, payload,
    status: feedbackConnection() ? 'PENDING' : 'NOT_CONNECTED' }, update: {} });
}

export async function leadFeedback(tx:Prisma.TransactionClient,lead:{leadKey:string;customerId:string|null;status:string;occurredAt:Date|null}) {
  if(!lead.customerId||lead.status!=='MATCHED'||!lead.occurredAt)return null;
  return enqueueFeedback(tx,{eventId:`lead:${sha(lead.leadKey)}:v1`,eventName:'Lead',customerId:lead.customerId,leadKey:lead.leadKey,eventTime:lead.occurredAt});
}

export async function contactedFeedback(tx:Prisma.TransactionClient,customerId:string,eventTime:Date) {
  const lead=await tx.customerLeadAttribution.findFirst({where:{customerId,status:'MATCHED',occurredAt:{lte:eventTime}},orderBy:[{occurredAt:'desc'},{leadKey:'desc'}]});
  return enqueueFeedback(tx,{eventId:`contacted:${customerId}:v1`,eventName:'Contacted',customerId,leadKey:lead?.leadKey,eventTime});
}

export async function purchaseFeedback(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { deal: true, attribution: true } });
  if (!order.deal || order.status === 'CANCELLED') return null;
  return enqueueFeedback(tx, { eventId: `purchase:${order.id}:v1`, eventName: 'Purchase', customerId: order.customerId,
    orderId: order.id, leadKey: order.attribution?.lastLeadKey, eventTime: order.deal.dealDate,
    value: order.deal.dealAmount, currency: order.deal.currency });
}

export async function qualifiedFeedback(tx:Prisma.TransactionClient,customerId:string,eventTime:Date) {
  const lead=await tx.customerLeadAttribution.findFirst({where:{customerId,status:'MATCHED',occurredAt:{lte:eventTime}},orderBy:[{occurredAt:'desc'},{leadKey:'desc'}]});
  return enqueueFeedback(tx,{eventId:`qualified:${customerId}:v1`,eventName:'LeadQualified',customerId,leadKey:lead?.leadKey,eventTime});
}

export async function recomputeAdvertisingFeedback(input: unknown, user: Actor) {
  const { customerId } = z.object({ customerId: z.string().trim().min(1).max(191) }).parse(input);
  return retryTransaction(()=>db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM Setting WHERE id = 'system' FOR UPDATE`);
    const c = await tx.customer.findFirst({where:{id:customerId,...scope(user)},include:{intelligence:true}});
    if(!c)throw new HttpError(404,'客户不存在或无访问权限');
    const leads=await tx.customerLeadAttribution.findMany({where:{customerId,status:'MATCHED'}});
    for(const source of leads)await leadFeedback(tx,source);
    const firstOutbound=await tx.whatsAppMessage.findFirst({where:{customerId,direction:'OUTBOUND',status:{notIn:['FAILED','PENDING','UNKNOWN']}},orderBy:[{sentAt:'asc'},{id:'asc'}],select:{sentAt:true}});
    if(firstOutbound)await contactedFeedback(tx,customerId,firstOutbound.sentAt);
    const lead = await tx.customerLeadAttribution.findFirst({ where: { customerId, status: 'MATCHED', occurredAt: { lte: new Date() } }, orderBy: [{ occurredAt: 'desc' }, { leadKey: 'desc' }] });
    if (c.isQualified === true) await enqueueFeedback(tx, { eventId: `qualified:${customerId}:v1`, eventName: 'LeadQualified', customerId, leadKey: lead?.leadKey, eventTime: c.updatedAt });
    const manual = c.intelligence?.humanOverrides as Record<string, unknown> | null;
    if (manual?.intent === 'HIGH') await enqueueFeedback(tx, { eventId: `intent:${customerId}:v1`, eventName: 'HighIntentLead', customerId, leadKey: lead?.leadKey, eventTime: c.intelligence!.updatedAt });
    const quotes = await tx.quotation.findMany({ where: { customerId, status: 'SENT', sentAt: { not: null } } });
    for (const quote of quotes) await enqueueFeedback(tx, { eventId: `quote:${quote.id}:v1`, eventName: 'QuoteSent', customerId, leadKey: lead?.leadKey, eventTime: quote.sentAt! });
    const orders = await tx.order.findMany({ where: { customerId, dealId: { not: null } }, select: { id: true } });
    for (const order of orders) await purchaseFeedback(tx, order.id);
    return tx.advertisingFeedback.findMany({ where: { customerId }, orderBy: { eventTime: 'desc' }, take: 100 });
  }));
}

/** At-least-once transport + stable event_id. Network calls are outside DB transactions. */
export async function deliverAdvertisingFeedback(input: unknown, user: Actor) {
  requireAdmin(user, '广告反馈投递需要管理员权限');
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(input);
  if (!feedbackConnection()) return { status: 'NOT_CONNECTED', sent: 0, failed: 0 };
  const now = new Date();
  const rows = await db.advertisingFeedback.findMany({ where: { OR: [
    { status: { in: ['PENDING', 'FAILED', 'NOT_CONNECTED'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    { status: 'PROCESSING', processingStartedAt: { lt: new Date(now.getTime() - 300_000) } },
  ] }, orderBy: { createdAt: 'asc' }, take: limit });
  let sent = 0, failed = 0;
  for (const row of rows) {
    if(row.orderId){
      const order=await db.order.findUnique({where:{id:row.orderId},include:{deal:true}});
      if(!order?.deal||order.status==='CANCELLED'){
        await db.advertisingFeedback.updateMany({where:{id:row.id,updatedAt:row.updatedAt},data:{status:'BUSINESS_CANCELLED'}});continue;
      }
    }
    const claim = new Date();
    const locked = await db.advertisingFeedback.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, status: row.status },
      data: { status: 'PROCESSING', processingStartedAt: claim, retryCount: { increment: 1 } } });
    if (!locked.count) continue;
    if (row.eventTime < new Date(now.getTime() - 7 * 86400000) || row.eventTime > now) {
      await db.advertisingFeedback.updateMany({ where: { id: row.id, processingStartedAt: claim }, data: { status: 'STALE', processingStartedAt: null } });
      continue;
    }
    let accepted = false, result: Prisma.InputJsonValue = {};
    try {
      const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(process.env.META_DATASET_ID!)}/events`, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.META_CAPI_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [row.payload] }), signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json() as { events_received?: number; error?: { code?: number }; fbtrace_id?: string };
      accepted = response.ok && body.events_received === 1;
      // Store diagnostics, never provider error prose that could contain a credential.
      result = { httpStatus: response.status, eventsReceived: body.events_received ?? 0, code: body.error?.code ?? null, traceId: body.fbtrace_id ?? null };
    } catch { result = { error: 'NETWORK_OR_RESPONSE_ERROR' }; }
    await db.advertisingFeedback.updateMany({ where: { id: row.id, status: 'PROCESSING', processingStartedAt: claim }, data: {
      status: accepted ? 'SENT' : 'FAILED', response: result, processingStartedAt: null, sentAt: accepted ? new Date() : null,
      nextAttemptAt: accepted ? null : new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(row.retryCount, 6))),
    } });
    if (accepted) sent++; else failed++;
  }
  return { status: 'CONNECTED', sent, failed };
}
