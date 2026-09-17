import { db } from '@/lib/db';
import { normalizeWhatsApp } from '@/lib/whatsapp';
import { resolveWhatsAppCustomer } from '@/services/whatsapp-identity-service';

type WebhookValue = {
  messaging_product?: string;
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: Array<Record<string, unknown> & {
    from?: string;
    id?: string;
    timestamp?: string;
    type?: string;
  }>;
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
  received: number;
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
  return `[${type.toUpperCase()}]`;
}

function parseTimestamp(value: string | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

async function defaultOwnerId() {
  const configured = process.env.WHATSAPP_DEFAULT_OWNER_EMAIL?.trim().toLowerCase();
  if (configured) {
    const owner = await db.user.findUnique({ where: { email: configured }, select: { id: true } });
    if (owner) return owner.id;
  }
  const admin = await db.user.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) throw new Error('无法接收 WhatsApp 新客户：CRM 中没有管理员账号');
  return admin.id;
}

async function resolveOrCreateCustomer(input: {
  waId: string;
  from: string;
  profileName: string;
  sentAt: Date;
}) {
  const resolution = await resolveWhatsAppCustomer({ waId: input.waId, phone: input.from });
  if (resolution.status === 'MATCHED') {
    return { status: 'MATCHED' as const, customerId: resolution.customerId };
  }
  if (resolution.status === 'AMBIGUOUS') return { status: 'AMBIGUOUS' as const };

  const normalized = normalizeWhatsApp(input.from || input.waId);
  const ownerId = await defaultOwnerId();
  const customer = await db.customer.create({
    data: {
      name: input.profileName || `WhatsApp ${normalized.slice(-4) || '客户'}`,
      ownerId,
      whatsapp: input.from || input.waId,
      whatsappNormalized: normalized,
      waId: normalizeWhatsApp(input.waId) || null,
      source: 'WHATSAPP',
      stage: 'NEW',
      inquiryAt: input.sentAt,
      lastWhatsAppAt: input.sentAt,
      lastInboundAt: input.sentAt,
      notes: '由 WhatsApp Webhook 自动创建。',
    },
  });
  await db.stageHistory.create({
    data: {
      customerId: customer.id,
      toStage: 'NEW',
      changedBy: ownerId,
      note: 'WhatsApp 首次入站消息自动创建客户',
    },
  });
  return { status: 'CREATED' as const, customerId: customer.id };
}

export async function ingestWhatsAppWebhook(payload: WhatsAppWebhookPayload): Promise<WhatsAppWebhookResult> {
  const result: WhatsAppWebhookResult = {
    received: 0,
    createdCustomers: 0,
    matchedCustomers: 0,
    duplicateMessages: 0,
    ambiguous: 0,
    statusesUpdated: 0,
  };

  if (payload.object !== 'whatsapp_business_account') return result;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages' || !change.value) continue;
      const value = change.value;

      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;
        const updated = await db.whatsAppMessage.updateMany({
          where: { waMessageId: status.id },
          data: { status: status.status },
        });
        result.statusesUpdated += updated.count;
      }

      const profileByWaId = new Map(
        (value.contacts ?? [])
          .filter((contact) => contact.wa_id)
          .map((contact) => [normalizeWhatsApp(contact.wa_id), contact.profile?.name ?? ''])
      );

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;
        result.received++;

        const existing = await db.whatsAppMessage.findUnique({
          where: { waMessageId: message.id },
          select: { id: true },
        });
        if (existing) {
          result.duplicateMessages++;
          continue;
        }

        const waId = normalizeWhatsApp(message.from);
        const sentAt = parseTimestamp(message.timestamp);
        const resolved = await resolveOrCreateCustomer({
          waId,
          from: message.from,
          profileName: profileByWaId.get(waId) ?? '',
          sentAt,
        });

        if (resolved.status === 'AMBIGUOUS') {
          result.ambiguous++;
          continue;
        }
        if (resolved.status === 'CREATED') result.createdCustomers++;
        else result.matchedCustomers++;

        await db.$transaction([
          db.whatsAppMessage.create({
            data: {
              customerId: resolved.customerId,
              waMessageId: message.id,
              waId,
              direction: 'INBOUND',
              messageType: (message.type || 'unknown').toUpperCase(),
              text: extractWhatsAppMessageText(message),
              status: 'received',
              sentAt,
              raw: JSON.stringify(message),
            },
          }),
          db.customer.update({
            where: { id: resolved.customerId },
            data: {
              waId,
              lastWhatsAppAt: sentAt,
              lastInboundAt: sentAt,
            },
          }),
        ]);
      }
    }
  }

  return result;
}
