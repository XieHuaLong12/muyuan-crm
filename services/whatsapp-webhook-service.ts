import { Prisma } from '@prisma/client';
import { HttpError } from '@/lib/auth';
import { parseGupshup, statusPredecessors } from '@/lib/gupshup';
import { db } from '@/lib/db';
import { normalizeWhatsApp } from '@/lib/whatsapp';
import { ensureConversation, messageFacts } from './conversation-identity-service';
import { identityKey, canonicalPhone } from '@/lib/contact-identity';
import { retryTransaction } from '@/lib/transaction-retry';

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

type Incoming = { id: string; phone: string; name: string; content: string; messageType: string; sentAt: Date; raw: unknown; accountId?: string; source?: 'cloud_api' | 'gupshup'; direction?: 'INBOUND' | 'OUTBOUND'; sender?: string; mediaUrl?: string | null; mimeType?: string | null; fileName?: string | null };

async function storeMessage(input: Incoming, result: WhatsAppWebhookResult) {
  const waId = normalizeWhatsApp(input.phone);
  const validPhone=canonicalPhone(input.phone,undefined,true);
  const direction = input.direction || 'INBOUND';
  if (direction === 'INBOUND') result.received++; else result.outboundEchoes++;
  let delta:Pick<WhatsAppWebhookResult,'customerIds'|'matchedCustomers'|'duplicateMessages'|'ambiguous'>={customerIds:[],matchedCustomers:0,duplicateMessages:0,ambiguous:0};
  await retryTransaction(()=>db.$transaction(async tx => {
    delta={customerIds:[],matchedCustomers:0,duplicateMessages:0,ambiguous:0};
    // One short database lock serializes identity resolution across app instances.
    // No provider or AI requests run while holding this lock.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM Setting WHERE id = 'system' FOR UPDATE`);
    const key=identityKey(input.source||'cloud_api',input.accountId||'primary',waId,input.id);
    const existing = await tx.whatsAppMessage.findUnique({ where: { waMessageId: input.id },include:{conversation:{include:{contact:true}}} });
    const sameAccount=existing?.conversation?.contact.provider===(input.source||'cloud_api')&&existing.conversation.contact.accountId===(input.accountId||'primary');
    if (existing && sameAccount) {
      if (direction === 'INBOUND') delta.customerIds.push(existing.customerId);
      delta.duplicateMessages++; return;
    }
    const duplicate=await tx.whatsAppUnmatchedMessage.findUnique({where:{sourceKey:key}});
    if(duplicate){delta.duplicateMessages++;return;}
    const linked=await ensureConversation(tx,{provider:input.source||'cloud_api',accountId:input.accountId||'primary',peerId:validPhone||waId||identityKey(input.phone),
      phone:input.phone,name:input.name,externalId:waId||identityKey(input.phone),sentAt:input.sentAt,direction,sourceMessageId:input.id});
    const owner=await tx.user.findFirstOrThrow({where:{role:'ADMIN'},orderBy:{createdAt:'asc'},select:{id:true}});
    if(!linked.customerId||existing){
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
    await tx.whatsAppMessage.create({ data: { customerId, conversationId:linked.conversation.id, sourceKey:key, waMessageId: input.id, waId, direction, source:input.source||'cloud_api',
      sender: input.sender || (direction === 'INBOUND' ? waId : 'BUSINESS'), content: input.content,
      messageType: input.messageType, mediaUrl: input.mediaUrl?.startsWith('https://') ? input.mediaUrl : null, mimeType: input.mimeType, fileName: input.fileName, status: direction === 'INBOUND' ? 'RECEIVED' : 'SENT',
      sentAt: input.sentAt, raw: JSON.stringify(input.raw) } });
    await messageFacts(tx,customerId,input.sentAt,direction);
  }));
  result.customerIds.push(...delta.customerIds);result.matchedCustomers+=delta.matchedCustomers;result.duplicateMessages+=delta.duplicateMessages;result.ambiguous+=delta.ambiguous;
}

export async function applyWhatsAppStatus(id: string, status: string, gsId?: string,account?:{provider:string;accountId:string}) {
  const predecessors = statusPredecessors(status);
  if (!predecessors.length) return 0;
  const updated = await db.whatsAppMessage.updateMany({ where: {
    direction: 'OUTBOUND', status: { in: predecessors },
    ...(account?{conversation:{contact:{provider:account.provider,accountId:account.accountId}}}:{}),
    OR: [{ waMessageId: id }, { providerMessageId: gsId || id }],
  }, data: { status, ...(gsId ? { waMessageId: id } : {}) } });
  return updated.count;
}

export async function ingestWhatsAppWebhook(input: unknown): Promise<WhatsAppWebhookResult> {
  const result: WhatsAppWebhookResult = { customerIds: [], received: 0, outboundEchoes: 0, createdCustomers: 0,
    matchedCustomers: 0, duplicateMessages: 0, ambiguous: 0, statusesUpdated: 0 };
  const root = asObject(input);
  if (!root) throw new HttpError(400, 'Webhook 必须为 JSON 对象');
  if (root.object !== 'whatsapp_business_account') {
    const parsed = parseGupshup(input);
    if (parsed.kind === 'message') await storeMessage({...parsed,source:'gupshup',accountId:process.env.GUPSHUP_SOURCE||'primary'}, result);
    if (parsed.kind === 'status') result.statusesUpdated = await applyWhatsAppStatus(parsed.id, parsed.status, parsed.gsId,{provider:'gupshup',accountId:process.env.GUPSHUP_SOURCE||'primary'});
    return result;
  }
  const payload = input as WhatsAppWebhookPayload;
  let recordFailures=0;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;
      if (change.field === 'messages') {
        for (const status of value.statuses || []) {
          if(status.id&&status.status)try{result.statusesUpdated+=await applyWhatsAppStatus(status.id,status.status.toUpperCase(),undefined,{provider:'cloud_api',accountId:value.metadata?.phone_number_id||'primary'});}catch{recordFailures++;}
        }
      }
      const outbound = change.field === 'smb_message_echoes';
      if (!outbound && change.field !== 'messages') continue;
      for (const message of (outbound ? value.message_echoes : value.messages) || []) {
        const phone = outbound ? message.to : message.from;
        if (!message.id || !phone) continue;
        const name = value.contacts?.find(c => normalizeWhatsApp(c.wa_id) === normalizeWhatsApp(phone))?.profile?.name || '';
        try{await storeMessage({ id: message.id, phone, name, content: extractWhatsAppMessageText(message),
          messageType: (message.type || 'unknown').toUpperCase(), sentAt: parseTimestamp(message.timestamp), raw: message,
          mimeType:typeof asObject(message[message.type||''])?.mime_type==='string'?String(asObject(message[message.type||''])!.mime_type):null,
          fileName:typeof asObject(message.document)?.filename==='string'?String(asObject(message.document)!.filename):null,
          accountId:value.metadata?.phone_number_id||'primary', direction: outbound ? 'OUTBOUND' : 'INBOUND', sender: message.from }, result);}catch{recordFailures++;}
      }
    }
  }
  if(recordFailures)throw new HttpError(503,'部分消息暂未保存，其他消息已保存，请重试');
  return result;
}
