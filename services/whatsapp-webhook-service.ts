import { Prisma } from '@prisma/client';
import { HttpError } from '@/lib/auth';
import { parseGupshup, statusPredecessors } from '@/lib/gupshup';
import { db } from '@/lib/db';
import { normalizeWhatsApp } from '@/lib/whatsapp';
import { resolveWhatsAppCustomer } from '@/services/whatsapp-identity-service';

type WebhookMessage = Record<string, unknown> & {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string;
  type?: string;
};

type WebhookValue = {
  messaging_product?: string;
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

type Incoming = { id: string; phone: string; name: string; content: string; messageType: string; sentAt: Date; raw: unknown; source?: 'cloud_api' | 'gupshup'; direction?: 'INBOUND' | 'OUTBOUND'; sender?: string; mediaUrl?: string | null; mimeType?: string | null; fileName?: string | null };

async function storeMessage(input: Incoming, result: WhatsAppWebhookResult) {
  const waId = normalizeWhatsApp(input.phone);
  if (!/^[1-9]\d{6,14}$/.test(waId)) throw new HttpError(400, 'Webhook 电话号码不合法');
  const direction = input.direction || 'INBOUND';
  if (direction === 'INBOUND') result.received++; else result.outboundEchoes++;
  await db.$transaction(async tx => {
    // One short database lock serializes identity resolution across app instances.
    // No provider or AI requests run while holding this lock.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM Setting WHERE id = 'system' FOR UPDATE`);
    const existing = await tx.whatsAppMessage.findUnique({ where: { waMessageId: input.id } });
    if (existing) {
      if (direction === 'INBOUND') result.customerIds.push(existing.customerId);
      result.duplicateMessages++; return;
    }
    const resolved = await resolveWhatsAppCustomer({ waId, phone: input.phone }, tx);
    if (resolved.status === 'AMBIGUOUS') {
      throw new HttpError(409, '多个客户匹配此 WhatsApp 号码，请合并重复客户后重试');
    }
    let customerId: string;
    if (resolved.status === 'MATCHED') { customerId = resolved.customerId; result.matchedCustomers++; }
    else {
      const email = process.env.WHATSAPP_DEFAULT_OWNER_EMAIL?.trim().toLowerCase();
      const owner = (email ? await tx.user.findUnique({ where: { email } }) : null) ||
        await tx.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
      if (!owner) throw new Error('CRM 中没有可分配的新客户负责人');
      const customer = await tx.customer.create({ data: { name: input.name || `WhatsApp ${waId.slice(-4)}`,
        ownerId: owner.id, phone: waId, whatsapp: waId, whatsappNormalized: waId, waId,
        source: 'WHATSAPP', stage: 'NEW', inquiryAt: input.sentAt } });
      customerId = customer.id;
      await tx.stageHistory.create({ data: { customerId, toStage: 'NEW', changedBy: owner.id, note: 'WhatsApp 首次消息自动创建客户' } });
      result.createdCustomers++;
    }
    if (direction === 'INBOUND') result.customerIds.push(customerId);
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    const latest = (previous: Date | null) => previous && previous > input.sentAt ? previous : input.sentAt;
    await tx.whatsAppMessage.create({ data: { customerId, waMessageId: input.id, waId, direction, source:input.source||'cloud_api',
      sender: input.sender || (direction === 'INBOUND' ? waId : 'BUSINESS'), content: input.content,
      messageType: input.messageType, mediaUrl: input.mediaUrl?.startsWith('https://') ? input.mediaUrl : null, mimeType: input.mimeType, fileName: input.fileName, status: direction === 'INBOUND' ? 'RECEIVED' : 'SENT',
      sentAt: input.sentAt, raw: JSON.stringify(input.raw) } });
    await tx.customer.update({ where: { id: customerId }, data: { waId,
      lastContactAt: latest(customer.lastContactAt), lastWhatsAppAt: latest(customer.lastWhatsAppAt),
      ...(direction === 'INBOUND' ? { lastInboundAt: latest(customer.lastInboundAt) } : { lastOutboundAt: latest(customer.lastOutboundAt) }) } });
  });
}

export async function applyWhatsAppStatus(id: string, status: string, gsId?: string) {
  const predecessors = statusPredecessors(status);
  if (!predecessors.length) return 0;
  const updated = await db.whatsAppMessage.updateMany({ where: {
    direction: 'OUTBOUND', status: { in: predecessors },
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
    if (parsed.kind === 'message') await storeMessage({...parsed,source:'gupshup'}, result);
    if (parsed.kind === 'status') result.statusesUpdated = await applyWhatsAppStatus(parsed.id, parsed.status, parsed.gsId);
    return result;
  }
  const payload = input as WhatsAppWebhookPayload;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;
      if (change.field === 'messages') {
        for (const status of value.statuses || []) {
          if (status.id && status.status) result.statusesUpdated += await applyWhatsAppStatus(status.id, status.status.toUpperCase());
        }
      }
      const outbound = change.field === 'smb_message_echoes';
      if (!outbound && change.field !== 'messages') continue;
      for (const message of (outbound ? value.message_echoes : value.messages) || []) {
        const phone = outbound ? message.to : message.from;
        if (!message.id || !phone) continue;
        const name = value.contacts?.find(c => normalizeWhatsApp(c.wa_id) === normalizeWhatsApp(phone))?.profile?.name || '';
        await storeMessage({ id: message.id, phone, name, content: extractWhatsAppMessageText(message),
          messageType: (message.type || 'unknown').toUpperCase(), sentAt: parseTimestamp(message.timestamp), raw: message,
          direction: outbound ? 'OUTBOUND' : 'INBOUND', sender: message.from }, result);
      }
    }
  }
  return result;
}
