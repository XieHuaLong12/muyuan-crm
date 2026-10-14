import { Prisma } from '@prisma/client';
import { HttpError } from '@/lib/auth';
import { parseGupshup, statusPredecessors, gupshupSource, providerTime } from '@/lib/gupshup';
import { db } from '@/lib/db';
import { withPhoneCountry } from '@/lib/phone-country';
import { normalizeWhatsApp } from '@/lib/whatsapp';
import { ensureConversation, messageFacts } from './conversation-identity-service';
import { identityKey, canonicalPhone } from '@/lib/contact-identity';
import { retryTransaction } from '@/lib/transaction-retry';
import { rememberCustomerContacts } from './contact-identity-service';
import { recordCtwaAttribution } from './ctwa-attribution-service';
import { z } from 'zod';
import { exactCrossSourceMessage } from './whatsapp-dedup-service';
import { MEDIA_MESSAGE_TYPES } from './whatsapp-media-service';

const externalId=z.string().max(191);
const cloudMessage=z.object({from:externalId.optional(),to:externalId.optional(),id:externalId.optional(),
  timestamp:z.string().max(32).optional(),type:z.string().max(40).optional()}).passthrough();
const cloudWebhookSchema=z.object({object:z.literal('whatsapp_business_account'),gs_app_id:externalId.optional(),
  entry:z.array(z.object({changes:z.array(z.object({field:z.string().max(80).optional(),value:z.object({
    metadata:z.object({phone_number_id:externalId.optional(),display_phone_number:externalId.optional()}).optional(),
    contacts:z.array(z.object({wa_id:externalId.optional(),profile:z.object({name:z.string().max(1000).optional()}).optional()})).max(100).optional(),
    messages:z.array(cloudMessage).max(100).optional(),message_echoes:z.array(cloudMessage).max(100).optional(),
    statuses:z.array(z.object({id:externalId.optional(),gs_id:externalId.optional(),meta_msg_id:externalId.optional(),
      status:z.string().max(24).optional(),timestamp:z.string().max(32).optional()})).max(100).optional(),
  }).optional()})).max(100).optional()})).max(100).optional()});

type WebhookMessage = Record<string, unknown> & {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string;
  type?: string;
};

type WebhookValue = {
  messaging_product?: string;
  metadata?: {phone_number_id?: string;display_phone_number?: string};
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: WebhookMessage[];
  message_echoes?: WebhookMessage[];
  statuses?: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    gs_id?: string;
    meta_msg_id?: string;
  }>;
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: WebhookValue;
    }>;
  }>;
};

export type WhatsAppWebhookResult = {
  customerIds: string[];
  received: number;
  outboundEchoes: number;
  createdCustomers: number;
  matchedCustomers: number;
  duplicateMessages: number;
  ambiguous: number;
  statusesUpdated: number;
  /** Newly stored inbound photos, videos, voice notes and documents whose files still need copying. */
  mediaMessageIds: string[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textField(parent: Record<string, unknown>, key: string, child: string) {
  const object = asObject(parent[key]);
  return typeof object?.[child] === 'string' ? String(object[child]) : '';
}

export function extractWhatsAppMessageText(message: Record<string, unknown>): string {
  const type = typeof message.type === 'string' ? message.type : 'unknown';
  if (type === 'text') return textField(message, 'text', 'body');
  if (type === 'image') return textField(message, 'image', 'caption') || '[图片]';
  if (type === 'video') return textField(message, 'video', 'caption') || '[视频]';
  if (type === 'document') {
    const document = asObject(message.document);
    const caption = typeof document?.caption === 'string' ? document.caption : '';
    const filename = typeof document?.filename === 'string' ? document.filename : '';
    return caption || (filename ? `[文件] ${filename}` : '[文件]');
  }
  if (type === 'audio') return '[语音/音频]';
  if (type === 'sticker') return '[贴纸]';
  if (type === 'location') {
    const location = asObject(message.location);
    const name = typeof location?.name === 'string' ? location.name : '';
    const address = typeof location?.address === 'string' ? location.address : '';
    return `[位置] ${[name, address].filter(Boolean).join(' · ')}`.trim();
  }
  if (type === 'button') return textField(message, 'button', 'text') || '[按钮回复]';
  if (type === 'interactive') {
    const interactive = asObject(message.interactive);
    const buttonReply = asObject(interactive?.button_reply);
    const listReply = asObject(interactive?.list_reply);
    const title = buttonReply?.title ?? listReply?.title;
    return typeof title === 'string' ? title : '[交互回复]';
  }
  if (type === 'contacts') return '[联系人]';
  if (type === 'reaction') return textField(message, 'reaction', 'emoji') || '[表情回应]';
  if (type === 'edit') return '[已编辑消息]';
  if (type === 'revoke') return '[已删除消息]';
  return `[${type.toUpperCase()}]`;
}

function parseTimestamp(value: string | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 && seconds < 8e12 ? new Date(seconds * 1000) : new Date();
}

type Incoming = { id: string; phone: string; name: string; content: string; messageType: string; sentAt: Date; raw: unknown;
  providerOccurredAt?:Date|null; referral?:Record<string,unknown>|null; accountId?: string; source?: 'cloud_api' | 'gupshup'; direction?: 'INBOUND' | 'OUTBOUND'; sender?: string; mediaUrl?: string | null; mimeType?: string | null; fileName?: string | null };

async function storeMessage(input: Incoming, result: WhatsAppWebhookResult) {
  const waId = normalizeWhatsApp(input.phone);
  const validPhone=canonicalPhone(input.phone,undefined,true);
  const direction = input.direction || 'INBOUND';
  if (direction === 'INBOUND') result.received++; else result.outboundEchoes++;
  let delta:Pick<WhatsAppWebhookResult,'customerIds'|'matchedCustomers'|'duplicateMessages'|'ambiguous'|'createdCustomers'|'mediaMessageIds'>={customerIds:[],matchedCustomers:0,duplicateMessages:0,ambiguous:0,createdCustomers:0,mediaMessageIds:[]};
  await retryTransaction(()=>db.$transaction(async tx => {
    delta={customerIds:[],matchedCustomers:0,duplicateMessages:0,ambiguous:0,createdCustomers:0,mediaMessageIds:[]};
    // One short database lock serializes identity resolution across app instances.
    // No provider or AI requests run while holding this lock.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM Setting WHERE id = 'system' FOR UPDATE`);
    const key=identityKey(input.source||'cloud_api',input.accountId||'primary',waId,input.id);
    if(await tx.whatsAppMessage.findUnique({where:{sourceKey:key}})){delta.duplicateMessages++;return;}
    const existing = await tx.whatsAppMessage.findUnique({ where: { waMessageId: input.id },include:{conversation:{include:{contact:true}}} });
    const sameAccount=existing?.conversation?.contact.provider===(input.source||'cloud_api')&&existing.conversation.contact.accountId===(input.accountId||'primary');
    if (existing && sameAccount) {
      if (direction === 'INBOUND') delta.customerIds.push(existing.customerId);
      delta.duplicateMessages++; return;
    }
    const duplicate=await tx.whatsAppUnmatchedMessage.findUnique({where:{sourceKey:key}});
    if(duplicate){delta.duplicateMessages++;return;}
    const conversationInput={provider:input.source||'cloud_api',accountId:input.accountId||'primary',peerId:validPhone||waId||identityKey(input.phone),
      phone:input.phone,name:input.name,externalId:waId||identityKey(input.phone),sentAt:input.sentAt,direction,sourceMessageId:input.id};
    let linked=await ensureConversation(tx,conversationInput);
    const assignment=await import('./lead-assignment-service');
    const owner=await assignment.intakeAdmin(tx);
    if(!linked.customerId&&linked.status==='UNMATCHED'&&validPhone&&input.source==='gupshup'&&direction==='INBOUND'){
      // WHATSAPP_DEFAULT_OWNER_EMAIL still wins when it names an active account; otherwise the lead assignment rules decide.
      const intake=await assignment.resolveIntakeOwner(tx,process.env.WHATSAPP_DEFAULT_OWNER_EMAIL);
      const c=await tx.customer.create({data:{name:input.name.slice(0,191)||validPhone,ownerId:intake.ownerId,
        ...withPhoneCountry({phone:input.phone,whatsapp:input.phone,waId}),phoneE164:validPhone,whatsappNormalized:waId,
        source:input.referral?'META_CLICK_TO_WHATSAPP':'WHATSAPP',sourceDetail:input.referral?'Gupshup referral':'Gupshup inbound',
        inquiryAt:input.providerOccurredAt||input.sentAt,stage:'NEW',stageSource:'SYSTEM'}});
      await rememberCustomerContacts(tx,c.id,'GUPSHUP_INBOUND');
      await tx.stageHistory.create({data:{customerId:c.id,toStage:'NEW',changedBy:owner.id,note:input.referral?'WhatsApp 广告入站':'WhatsApp 入站'}});
      await assignment.enterIntake(tx,c.id,owner.id,intake,input.referral?'WhatsApp 广告':'WhatsApp 入站');
      linked=await ensureConversation(tx,conversationInput);delta.createdCustomers++;
    }
    if(linked.customerId&&input.source==='gupshup'&&direction==='INBOUND'){
      // Legacy customers can match through raw contacts before canonical fields exist.
      await rememberCustomerContacts(tx,linked.customerId,'GUPSHUP_INBOUND');
    }
    if(input.referral)await recordCtwaAttribution(tx,{provider:input.source||'cloud_api',accountId:input.accountId||'primary',messageId:input.id,
      customerId:linked.customerId,phoneRaw:input.phone,phoneE164:validPhone,at:input.providerOccurredAt||null,referral:input.referral,status:linked.status});
    if(linked.customerId&&input.source==='gupshup'&&await exactCrossSourceMessage(tx,{nativeId:input.id,accountPhone:input.accountId||'',peerPhone:input.phone,direction,source:'gupshup',customerId:linked.customerId})){
      await tx.whatsAppUnmatchedMessage.create({data:{sourceKey:key,provider:'gupshup',providerAccountId:input.accountId,userId:owner.id,
        accountPhone:input.accountId!,conversationId:waId,canonicalConversationId:linked.conversation.id,sourceMessageId:input.id,peerPhone:validPhone,
        direction:direction.toLowerCase(),sentAt:input.sentAt,content:input.content,attachments:JSON.stringify({raw:input.raw}),reason:'CROSS_SOURCE_DUPLICATE',status:'IMPORTED',customerId:linked.customerId}});
      if(direction==='INBOUND'&&input.providerOccurredAt)await tx.whatsAppConversation.updateMany({where:{id:linked.conversation.id,OR:[{lastCustomerMessageAt:null},{lastCustomerMessageAt:{lt:input.providerOccurredAt}}]},data:{lastCustomerMessageAt:input.providerOccurredAt}});
      if(direction==='INBOUND'&&/^(stop|unsubscribe|不要联系|请勿联系|停止联系|退订)[.!。！\s]*$/i.test(input.content.trim())){
        await tx.customer.update({where:{id:linked.customerId},data:{whatsappOptInStatus:'OPTED_OUT',whatsappOptOutAt:input.providerOccurredAt||new Date()}});
        await tx.identityAudit.create({data:{entityType:'WHATSAPP_CONSENT',entityId:linked.customerId,actorId:'SYSTEM',reason:'客户明确退订',detail:{messageId:input.id,provider:input.source}}});
      }
      delta.customerIds.push(linked.customerId);delta.matchedCustomers++;delta.duplicateMessages++;return;
    }
    if(!linked.customerId||(existing&&input.source!=='gupshup')){
      await tx.whatsAppUnmatchedMessage.create({data:{sourceKey:key,provider:input.source||'cloud_api',userId:owner.id,
        accountPhone:'primary',providerAccountId:input.accountId||'primary',conversationId:waId||identityKey(input.phone),canonicalConversationId:linked.conversation.id,sourceMessageId:input.id,
        peerPhone:linked.contact.phoneE164,peerName:input.name,direction:direction.toLowerCase(),sentAt:input.sentAt,content:input.content,
        attachments:JSON.stringify({messageType:input.messageType,mediaUrl:input.mediaUrl,mimeType:input.mimeType,fileName:input.fileName,raw:input.raw}),
        reason:!validPhone?'INVALID_PHONE':existing?'MESSAGE_ID_CONFLICT':linked.status==='AMBIGUOUS'?'AMBIGUOUS':'NO_MATCH'}});
      if(linked.status==='AMBIGUOUS')delta.ambiguous++;
      return;
    }
    const customerId=linked.customerId;
    delta.matchedCustomers++;
    if(direction==='INBOUND')delta.customerIds.push(customerId);
    const stored = await tx.whatsAppMessage.create({ data: { customerId, conversationId:linked.conversation.id, sourceKey:key, waMessageId: existing ? null : input.id,
      sourceMessageId:input.id,providerAccountId:input.accountId||'primary',providerOccurredAt:input.providerOccurredAt,
      sourcePhone:direction==='INBOUND'?validPhone:canonicalPhone(input.sender,undefined,true),destinationPhone:direction==='INBOUND'?canonicalPhone(input.accountId,undefined,true):validPhone,
      waId, direction, source:input.source||'cloud_api',
      sender: input.sender || (direction === 'INBOUND' ? waId : 'BUSINESS'), content: input.content,
      messageType: input.messageType, mediaUrl: input.mediaUrl?.startsWith('https://') ? input.mediaUrl : null, mimeType: input.mimeType, fileName: input.fileName, status: direction === 'INBOUND' ? 'RECEIVED' : 'SENT',
      sentAt: input.sentAt, raw: JSON.stringify(input.raw) }, select: { id: true } });
    if (direction === 'INBOUND' && MEDIA_MESSAGE_TYPES.has(input.messageType)) delta.mediaMessageIds.push(stored.id);
    await messageFacts(tx,customerId,input.sentAt,direction);
    if(direction==='INBOUND'&&input.providerOccurredAt){
      await tx.whatsAppConversation.updateMany({where:{id:linked.conversation.id,OR:[{lastCustomerMessageAt:null},{lastCustomerMessageAt:{lt:input.providerOccurredAt}}]},data:{lastCustomerMessageAt:input.providerOccurredAt}});
    }
    if(direction==='INBOUND'&&/^(stop|unsubscribe|不要联系|请勿联系|停止联系|退订)[.!。！\s]*$/i.test(input.content.trim())){
      await tx.customer.update({where:{id:customerId},data:{whatsappOptInStatus:'OPTED_OUT',whatsappOptOutAt:input.providerOccurredAt||new Date()}});
      await tx.identityAudit.create({data:{entityType:'WHATSAPP_CONSENT',entityId:customerId,actorId:'SYSTEM',reason:'客户明确退订',detail:{messageId:input.id,provider:input.source}}});
    }
  }));
  result.customerIds.push(...delta.customerIds);result.mediaMessageIds.push(...delta.mediaMessageIds);result.matchedCustomers+=delta.matchedCustomers;result.duplicateMessages+=delta.duplicateMessages;result.ambiguous+=delta.ambiguous;result.createdCustomers+=delta.createdCustomers;
}

export async function applyWhatsAppStatus(id: string, status: string, gsId?: string,account?:{provider:string;accountId:string}) {
  const predecessors = statusPredecessors(status);
  if (!predecessors.length) return 0;
  const updated = await db.whatsAppMessage.updateMany({ where: {
    direction: 'OUTBOUND', status: { in: predecessors },
    ...(account?{source:account.provider,OR:[{providerAccountId:account.accountId},{providerAccountId:null,conversation:{contact:{provider:account.provider,accountId:account.accountId}}}]}:{}),
    AND:[{OR: [{ waMessageId: id }, { sourceMessageId: id }, { providerMessageId: gsId || id }]}],
  }, data: { status, ...(gsId ? { waMessageId: id } : {}) } });
  return updated.count;
}

/** Persist before matching: callbacks may precede the send API response/database commit. */
export async function recordWhatsAppReceipt(input:{id:string;gsId?:string;status:string;provider:string;accountId:string;occurredAt:Date|null;failureCode?:string|null}) {
  const key=identityKey(input.provider,input.accountId,input.id,input.gsId||'',input.status,input.occurredAt?.toISOString()||'');
  const receipt=await db.whatsAppStatusReceipt.upsert({where:{receiptKey:key},create:{receiptKey:key,provider:input.provider,accountId:input.accountId,
    messageId:input.id,gsId:input.gsId,status:input.status,occurredAt:input.occurredAt,failureCode:input.failureCode},update:{}});
  if(receipt.appliedAt)return 0;
  const count=await applyWhatsAppStatus(input.id,input.status,input.gsId,{provider:input.provider,accountId:input.accountId});
  const messages=await db.whatsAppMessage.findMany({where:{source:input.provider,providerAccountId:input.accountId,direction:'OUTBOUND',
    OR:[{waMessageId:input.id},{sourceMessageId:input.id},{providerMessageId:input.gsId||input.id}]},select:{id:true}});
  if(messages.length){
    await db.$transaction(async tx=>{
      const time=input.occurredAt;
      const stamp=input.status==='DELIVERED'?'deliveredAt':input.status==='READ'?'readAt':input.status==='FAILED'?'failedAt':null;
      if(stamp&&time)await tx.whatsAppMessage.updateMany({where:{id:{in:messages.map(m=>m.id)},[stamp]:null},data:{[stamp]:time}});
      if(input.status==='READ'&&time)await tx.whatsAppMessage.updateMany({where:{id:{in:messages.map(m=>m.id)},deliveredAt:null},data:{deliveredAt:time}});
      await tx.whatsAppStatusReceipt.update({where:{id:receipt.id},data:{appliedAt:new Date()}});
    });
  }
  return count;
}

export async function replayWhatsAppReceipts(provider:string,accountId:string,messageId:string) {
  const rows=await db.whatsAppStatusReceipt.findMany({where:{provider,accountId,appliedAt:null,OR:[{messageId},{gsId:messageId}]},orderBy:{createdAt:'asc'},take:100});
  for(const r of rows)await recordWhatsAppReceipt({id:r.messageId,gsId:r.gsId||undefined,status:r.status,provider,accountId,occurredAt:r.occurredAt,failureCode:r.failureCode});
}

export function validateWhatsAppWebhook(input: unknown) {
  const root = z.record(z.unknown()).parse(input);
  if (root.object !== 'whatsapp_business_account') {
    parseGupshup(root);
    return root;
  }
  const payload = cloudWebhookSchema.parse(root);
  if (typeof root.gs_app_id === 'string') {
    const accountId = gupshupSource();
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      if (change.value && (!accountId || canonicalPhone(change.value.metadata?.display_phone_number, undefined, true) !== accountId)) {
        throw new HttpError(400, 'Gupshup 回调业务号码与服务器配置不一致');
      }
    }
  }
  return root;
}

async function ingest(input: unknown): Promise<WhatsAppWebhookResult> {
  const result: WhatsAppWebhookResult = { customerIds: [], received: 0, outboundEchoes: 0, createdCustomers: 0,
    matchedCustomers: 0, duplicateMessages: 0, ambiguous: 0, statusesUpdated: 0, mediaMessageIds: [] };
  const root = asObject(input);
  if (!root) throw new HttpError(400, 'Webhook 必须为 JSON 对象');
  if (root.object !== 'whatsapp_business_account') {
    const parsed = parseGupshup(input);
    const accountId=gupshupSource()||'primary';
    if (parsed.kind === 'message') await storeMessage({...parsed,source:'gupshup',accountId}, result);
    if (parsed.kind === 'status') result.statusesUpdated = await recordWhatsAppReceipt({...parsed,provider:'gupshup',accountId});
    return result;
  }
  const payload:WhatsAppWebhookPayload = cloudWebhookSchema.parse(input);
  const gupshupV3=typeof root.gs_app_id==='string';
  let recordFailures=0;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;
      const provider=gupshupV3?'gupshup':'cloud_api';
      const accountId=gupshupV3?gupshupSource():value.metadata?.phone_number_id||'primary';
      if(gupshupV3&&(!accountId||canonicalPhone(value.metadata?.display_phone_number,undefined,true)!==accountId))throw new HttpError(400,'Gupshup 回调业务号码与服务器配置不一致');
      if (change.field === 'messages') {
        for (const status of value.statuses || []) {
          if(status.id&&status.status)try{result.statusesUpdated+=await recordWhatsAppReceipt({id:status.meta_msg_id||status.id,gsId:status.gs_id||status.id,status:status.status.toUpperCase(),provider,accountId:accountId!,occurredAt:providerTime(status.timestamp,true)});}catch{recordFailures++;}
        }
      }
      const outbound = change.field === 'smb_message_echoes';
      if (!outbound && change.field !== 'messages') continue;
      for (const message of (outbound ? value.message_echoes : value.messages) || []) {
        const phone = outbound ? message.to : message.from;
        if (!message.id || !phone) continue;
        const name = value.contacts?.find(c => normalizeWhatsApp(c.wa_id) === normalizeWhatsApp(phone))?.profile?.name || '';
        const media = asObject(message[message.type||'']);
        try{await storeMessage({ id: message.id, phone, name, content: extractWhatsAppMessageText(message),
          messageType: (message.type || 'unknown').toUpperCase(), sentAt: parseTimestamp(message.timestamp), raw: message,
          mimeType:typeof media?.mime_type==='string'?media.mime_type:null,
          // Gupshup V3 adds a download link next to Meta's media id; Cloud API only has the id (fetched later with the token).
          mediaUrl:typeof media?.url==='string'?media.url:null,
          fileName:typeof asObject(message.document)?.filename==='string'?String(asObject(message.document)!.filename):null,
          providerOccurredAt:providerTime(message.timestamp,true),referral:asObject(message.referral),
          source:provider,accountId:accountId!, direction: outbound ? 'OUTBOUND' : 'INBOUND', sender: message.from }, result);}catch{recordFailures++;}
      }
    }
  }
  if(recordFailures)throw new HttpError(503,'部分消息暂未保存，其他消息已保存，请重试');
  return result;
}

export async function ingestWhatsAppWebhook(input: unknown): Promise<WhatsAppWebhookResult> {
  const root=asObject(input);
  const isGupshup=!!root&&(root.object!=='whatsapp_business_account'||typeof root.gs_app_id==='string');
  const job=isGupshup?await db.syncJob.create({data:{provider:'GUPSHUP',jobType:'WEBHOOK',status:'RUNNING',detail:{providerAccountId:gupshupSource()||'NOT_CONNECTED'}}}):null;
  try{
    const result=await ingest(input);
    if(job)await db.syncJob.update({where:{id:job.id},data:{status:'OK',completedAt:new Date(),processed:result.received+result.outboundEchoes,
      succeeded:result.matchedCustomers,failed:0,detail:{providerAccountId:gupshupSource()||'NOT_CONNECTED',createdCustomers:result.createdCustomers,duplicates:result.duplicateMessages,ambiguous:result.ambiguous,statusesUpdated:result.statusesUpdated}}});
    return result;
  }catch(error){
    if(job)await db.syncJob.update({where:{id:job.id},data:{status:'FAILED',completedAt:new Date(),failed:1,error:error instanceof HttpError?'INVALID_PROVIDER_ACCOUNT':'WEBHOOK_PROCESSING_FAILED'}});
    throw error;
  }
}
