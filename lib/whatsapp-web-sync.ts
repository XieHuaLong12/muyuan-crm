import { createHash } from 'node:crypto';
import { z } from 'zod';

export function e164(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/[\s().-]/g, '');
  const international = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : null;
}

// Existing CRM waId/whatsappNormalized values are international digits without '+'.
export function storedE164(value: string | null | undefined): string | null {
  if (!value) return null;
  return e164(value) || (/^[1-9]\d{7,14}$/.test(value.trim()) ? `+${value.trim()}` : null);
}

const attachment = z.object({
  kind: z.enum(['image', 'video', 'audio', 'document', 'sticker']),
  fileName: z.string().max(255).refine(v => !/^(?:https?:|blob:|data:|file:)/i.test(v.trim()), '附件名不能是链接').optional(),
  mimeType: z.string().max(100).regex(/^[\w.+-]+\/[\w.+-]+$/).optional(),
  sizeBytes: z.number().int().nonnegative().max(1_000_000_000).optional(),
}).strict();

export const webMessage = z.object({
  sourceMessageId: z.string().min(1).max(500),
  conversationId: z.string().min(1).max(191),
  peerPhone: z.string().max(32).nullable(),
  peerName: z.string().max(191).default(''),
  direction: z.enum(['inbound', 'outbound']),
  sentAt: z.string().datetime({ offset: true }),
  text: z.string().max(16000),
  attachments: z.array(attachment).max(8).default([]),
}).strict().refine(m => Boolean(m.text.trim()) || m.attachments.length > 0, '空消息不能同步');
export const webBatch = z.object({ accountPhone: z.string().max(32), messages: z.array(webMessage).min(1).max(200) }).strict();
export type WebMessage = z.infer<typeof webMessage>;

export function sourceKey(accountPhone: string, message: Pick<WebMessage, 'conversationId' | 'sourceMessageId'>): string {
  return createHash('sha256').update(JSON.stringify(['whatsapp_web', accountPhone, message.conversationId, message.sourceMessageId])).digest('hex');
}

export function matchPhone<T extends { id: string; name: string; phone: string; whatsapp: string; whatsappNormalized: string; waId: string | null }>(peer: string | null, customers: T[]) {
  const phone = e164(peer);
  if (!phone) return { status: 'unmatched' as const, phone: null, reason: '缺少可确认的国际号码' };
  const matches = customers.filter(c => e164(c.phone) === phone || e164(c.whatsapp) === phone ||
    storedE164(c.whatsappNormalized) === phone || storedE164(c.waId) === phone);
  if (matches.length === 1) return { status: 'matched' as const, phone, customer: { id: matches[0].id, name: matches[0].name } };
  if (matches.length > 1) return { status: 'ambiguous' as const, phone, reason: '多个客户使用同一号码' };
  return { status: 'unmatched' as const, phone, reason: '未找到同号客户' };
}
