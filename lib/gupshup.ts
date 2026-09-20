import { z } from 'zod';

const envelope = z.object({
  app: z.string().optional(), timestamp: z.number().finite().positive().optional(),
  type: z.string(), payload: z.record(z.unknown()).optional(),
});
const inbound = z.object({
  id: z.string().min(1).max(191), source: z.string().optional(), type: z.string().min(1),
  sender: z.object({ phone: z.string().optional(), name: z.string().optional() }).optional(),
  payload: z.record(z.unknown()),
});
const field = (data: Record<string, unknown>, key: string) => typeof data[key] === 'string' ? data[key] as string : '';

export function parseGupshup(input: unknown) {
  const event = envelope.parse(input);
  if (event.type === 'message') {
    const message = inbound.parse(event.payload);
    const phone = message.source || message.sender?.phone || '';
    const payload = message.payload;
    const content = field(payload, 'text') || field(payload, 'caption') || field(payload, 'title') ||
      field(payload, 'filename') || `[${message.type.toUpperCase()}]`;
    return { kind: 'message' as const, id: message.id, phone, name: message.sender?.name || '',
      content, mediaUrl: field(payload,'url') || null, mimeType: field(payload,'contentType') || null, fileName: field(payload,'filename') || null, messageType: message.type.toUpperCase(), sentAt: new Date(event.timestamp || Date.now()), raw: message };
  }
  if (event.type === 'message-event') {
    const data = z.object({ id: z.string().min(1).max(191), gsId: z.string().max(191).optional(),
      type: z.string() }).parse(event.payload);
    return { kind: 'status' as const, id: data.id, gsId: data.gsId, status: data.type.toUpperCase() };
  }
  return { kind: 'ignored' as const };
}

// Late or repeated receipts must not regress delivered/read messages.
export function statusPredecessors(status: string): string[] {
  const pending = ['PENDING', 'UNKNOWN', 'ENQUEUED'];
  if (status === 'ENQUEUED') return ['PENDING', 'UNKNOWN'];
  if (status === 'SENT') return [...pending, 'sent', 'SENT'];
  if (status === 'DELIVERED') return [...pending, 'SENT', 'sent', 'delivered', 'DELIVERED'];
  if (status === 'READ') return [...pending, 'SENT', 'sent', 'DELIVERED', 'delivered', 'read', 'READ'];
  if (status === 'FAILED') return [...pending, 'SENT', 'sent', 'failed', 'FAILED'];
  return [];
}
