import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,requireAdmin } from '@/lib/auth';
import { gupshupSource } from '@/lib/gupshup';
import { canonicalPhone } from '@/lib/contact-identity';
import { resolveContact } from './contact-identity-service';
import { customerServiceWindow } from './whatsapp-window-service';
import { identityChain } from './identity-chain-service';

export async function gupshupIntegrationStatus(input:unknown,user:Actor) {
  z.object({}).strict().parse(input);
  requireAdmin(user);
  const source=gupshupSource();
  const account={source:'gupshup',providerAccountId:source||'NOT_CONNECTED'};
  const [incoming,outgoing,webhook,failed,unmatched,unknownConsent,liveConversation]=await Promise.all([
    db.whatsAppMessage.findFirst({where:{...account,direction:'INBOUND'},select:{sentAt:true,providerOccurredAt:true},orderBy:{createdAt:'desc'}}),
    db.whatsAppMessage.findFirst({where:{...account,direction:'OUTBOUND'},select:{sentAt:true,status:true},orderBy:{createdAt:'desc'}}),
    source?db.syncJob.findFirst({where:{provider:'GUPSHUP',jobType:'WEBHOOK',detail:{path:'$.providerAccountId',equals:source}},select:{startedAt:true,completedAt:true,status:true,error:true},orderBy:{startedAt:'desc'}}):Promise.resolve(null),
    db.whatsAppMessage.count({where:{...account,status:'FAILED'}}),
    db.whatsAppUnmatchedMessage.count({where:{provider:'gupshup',status:'PENDING'}}),
    db.customer.count({where:{deletedAt:null,whatsappOptInStatus:'UNKNOWN'}}),
    db.whatsAppConversation.findFirst({where:{contact:{provider:'gupshup',accountId:source||'NOT_CONNECTED'},lastCustomerMessageAt:{not:null}},orderBy:{lastCustomerMessageAt:'desc'},select:{lastCustomerMessageAt:true}}),
  ]);
  const configured=!!(process.env.GUPSHUP_API_KEY?.trim()&&process.env.GUPSHUP_APP_NAME?.trim()&&source&&process.env.GUPSHUP_WEBHOOK_SECRET?.trim());
  return {provider:'GUPSHUP',sourceNumber:source,appName:process.env.GUPSHUP_APP_NAME||null,
    status:!configured?'NOT_CONNECTED':liveConversation?.lastCustomerMessageAt?webhook?.status==='FAILED'?'LIVE_INBOUND_VERIFIED_WITH_ERROR':'LIVE_INBOUND_VERIFIED':'CONFIGURED_UNVERIFIED',
    webhookStatus:webhook?.status||'NOT_VERIFIED',lastIncoming:liveConversation?.lastCustomerMessageAt||incoming?.providerOccurredAt||incoming?.sentAt||null,
    lastOutgoing:outgoing?.sentAt||null,lastOutgoingStatus:outgoing?.status||null,lastWebhook:webhook?.startedAt||null,
    lastError:webhook?.error||null,failedMessages:failed,unmatchedMessages:unmatched,unknownConsentCustomers:unknownConsent,
    templateStatus:'NOT_CONNECTED',credentialsConfigured:configured,
    requiredConfiguration:['GUPSHUP_API_KEY','GUPSHUP_APP_NAME','GUPSHUP_SOURCE_NUMBER (兼容 GUPSHUP_SOURCE)','GUPSHUP_WEBHOOK_SECRET']};
}

export async function integrationDebug(input:unknown,user:Actor) {
  requireAdmin(user);
  const v=z.object({q:z.string().trim().min(1).max(191)}).parse(input);
  const phone=canonicalPhone(v.q,undefined,true);
  const customer=await db.customer.findFirst({where:{id:v.q,deletedAt:null},select:{id:true}});
  const message=await db.whatsAppMessage.findFirst({where:{OR:[{id:v.q},{waMessageId:v.q},{sourceMessageId:v.q},{providerMessageId:v.q}]},select:{customerId:true,id:true,source:true,providerAccountId:true,status:true}});
  const resolved=phone?await resolveContact({phones:[phone]}):null;
  const id=customer?.id||message?.customerId||(resolved?.status==='MATCHED'?resolved.customerId:null);
  if(!id)return {checks:[{name:'Customer',status:resolved?.status==='AMBIGUOUS'?'FAIL':'NOT_FOUND'}],chain:null};
  const chain=await identityChain({customerId:id},user),window=await customerServiceWindow(id,user);
  return {checks:[{name:'Gupshup message',status:chain.messages.some(m=>m.source==='gupshup')||chain.conversations.some(c=>c.contact.provider==='gupshup'&&c.lastCustomerMessageAt)?'PASS':'NOT_FOUND'},
    {name:'Customer',status:'PASS'},{name:'Phone identity',status:chain.customer.phoneE164?'PASS':'NOT_FOUND'},
    {name:'Conversation',status:chain.conversations.length?'PASS':'NOT_FOUND'},
    {name:'Messages',status:chain.messages.length?'PASS':'NOT_FOUND'},
    {name:'AI analysis',status:chain.intelligence?.aiAnalysis?'PASS':chain.intelligence?.analysisError?'FAIL':'NOT_FOUND'},
    {name:'Sent quotation',status:chain.quotations.some(q=>q.status==='SENT'&&q.sentAt)?'PASS':'NOT_FOUND'},
    {name:'Acquisition attribution',status:chain.leads.some(l=>l.adId)?'PASS':'NOT_FOUND'},
    {name:'Order attribution',status:chain.orders.length?chain.orders.every(o=>o.attribution?.status==='ATTRIBUTED')?'PASS':'FAIL':'NOT_FOUND'}],
    customerId:id,message,window,chain};
}

// ── Diagnostics: what Gupshup actually delivered, and how far each customer message got ──
type Delivered = { at: Date; format: 'V2' | 'V3'; id: string; type: string; linkHost: string | null; mediaId: boolean; receipt: string; receiptError: string | null };
const obj = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const host = (value: string | null) => { if (!value) return null; try { return new URL(value).hostname; } catch { return '无效链接'; } };

/** Customer messages inside one stored webhook body (Gupshup V2 or Meta-format V3); only types and hosts, never links or content. */
function deliveredMessages(payload: unknown): Omit<Delivered, 'at' | 'receipt' | 'receiptError'>[] {
  const root = obj(payload);
  if (!root) return [];
  if (root.type === 'message') {
    const message = obj(root.payload), inner = obj(message?.payload);
    const id = str(message?.id), type = str(message?.type);
    return id && type ? [{ format: 'V2', id, type, linkHost: host(str(inner?.url)), mediaId: !!(str(inner?.mediaId) || str(inner?.id)) }] : [];
  }
  if (root.object !== 'whatsapp_business_account') return [];
  const out: Omit<Delivered, 'at' | 'receipt' | 'receiptError'>[] = [];
  for (const entry of Array.isArray(root.entry) ? root.entry : []) for (const change of Array.isArray(obj(entry)?.changes) ? obj(entry)!.changes as unknown[] : []) {
    if (obj(change)?.field !== 'messages') continue;
    for (const message of Array.isArray(obj(obj(change)?.value)?.messages) ? obj(obj(change)!.value)!.messages as unknown[] : []) {
      const m = obj(message), id = str(m?.id), type = str(m?.type);
      if (!id || !type) continue;
      const media = obj(m?.[type]);
      out.push({ format: 'V3', id, type, linkHost: host(str(media?.url) || str(media?.link)), mediaId: !!str(media?.id) });
    }
  }
  return out;
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'voice', 'document', 'file', 'sticker']);
export async function inboundDiagnostics(input: unknown, user: Actor) {
  z.object({}).strict().parse(input);
  requireAdmin(user);
  const receipts = await db.syncJob.findMany({ where: { provider: 'GUPSHUP', jobType: 'WEBHOOK_INBOX' }, orderBy: { startedAt: 'desc' }, take: 80,
    select: { startedAt: true, status: true, error: true, detail: true } });
  const delivered: Delivered[] = [];
  for (const receipt of receipts) for (const message of deliveredMessages(obj(receipt.detail)?.payload))
    delivered.push({ ...message, at: receipt.startedAt, receipt: receipt.status, receiptError: receipt.error });
  const latest = delivered.slice(0, 20), ids = latest.map(item => item.id);
  const [stored, waiting, failures] = await Promise.all([
    ids.length ? db.whatsAppMessage.findMany({ where: { OR: [{ waMessageId: { in: ids } }, { sourceMessageId: { in: ids } }] }, select: { id: true, waMessageId: true, sourceMessageId: true, mediaUrl: true } }) : [],
    ids.length ? db.whatsAppUnmatchedMessage.findMany({ where: { sourceMessageId: { in: ids } }, select: { sourceMessageId: true, status: true, reason: true } }) : [],
    db.syncJob.findMany({ where: { provider: 'GUPSHUP', jobType: 'MEDIA_DOWNLOAD' }, orderBy: { startedAt: 'desc' }, take: 200, select: { error: true, detail: true, startedAt: true } }),
  ]);
  const failureByMessage = new Map<string, { error: string | null; attempts: unknown }>();
  for (const failure of failures) {
    const messageId = str(obj(failure.detail)?.messageId);
    if (messageId && !failureByMessage.has(messageId)) failureByMessage.set(messageId, { error: failure.error, attempts: obj(failure.detail)?.attempts });
  }
  const rows = latest.map(item => {
    const message = stored.find(m => m.waMessageId === item.id || m.sourceMessageId === item.id);
    const pending = waiting.find(w => w.sourceMessageId === item.id);
    const isMedia = MEDIA_TYPES.has(item.type.toLowerCase());
    const failure = message ? failureByMessage.get(message.id) : undefined;
    const attempts = Array.isArray(failure?.attempts) ? (failure!.attempts as { host?: string; auth?: string; status?: unknown }[])
      .map(a => `${a.host ?? '?'}${a.auth && a.auth !== 'none' ? `（${a.auth}）` : ''} → ${String(a.status)}`).join('；') : '';
    return { at: item.at, format: item.format, type: item.type, link: item.linkHost, mediaId: item.mediaId,
      result: message ? 'IN_CHAT' : pending ? `WAITING:${pending.reason}` : item.receipt === 'FAILED' ? 'NOT_SAVED' : item.receipt === 'OK' ? 'NOT_FOUND' : 'PROCESSING',
      receiptError: item.receiptError,
      file: !isMedia ? null : message?.mediaUrl?.startsWith('/api/whatsapp/media/') ? 'SAVED' : failure ? 'FAILED' : message ? 'NOT_YET' : null,
      fileError: failure?.error ?? null, attempts: attempts || null };
  });
  return { rows, receiptsScanned: receipts.length };
}
