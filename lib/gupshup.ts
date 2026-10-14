import { z } from 'zod';
import { canonicalPhone } from './contact-identity';

const envelope = z.object({
  app: z.string().optional(), timestamp: z.number().finite().positive().optional(),
  type: z.string(), payload: z.record(z.unknown()).optional(),
});
const inbound = z.object({
  id: z.string().min(1).max(191), source: z.string().optional(), type: z.string().min(1),
  sender: z.object({ phone: z.string().optional(), name: z.string().optional() }).optional(),
  referral: z.record(z.unknown()).optional(),
  payload: z.record(z.unknown()),
});
const field = (data: Record<string, unknown>, key: string) => typeof data[key] === 'string' ? data[key] as string : '';

export const gupshupSource = () => canonicalPhone(process.env.GUPSHUP_SOURCE_NUMBER || process.env.GUPSHUP_SOURCE, undefined, true);
export function providerTime(value: unknown, seconds = false): Date | null {
  const n = Number(value), ms = seconds ? n * 1000 : n;
  // Missing/invalid/future provider times never manufacture an open window.
  return value != null && Number.isFinite(ms) && ms >= 946684800000 && ms <= Date.now() + 60_000 ? new Date(Math.min(ms, Date.now())) : null;
}

export function parseGupshup(input: unknown) {
  const event = envelope.parse(input);
  if (event.type === 'message') {
    const message = inbound.parse(event.payload);
    const phone = message.source || message.sender?.phone || '';
    const payload = message.payload;
    // V2 files carry their name in `name`; older payloads used `filename`.
    const fileName = field(payload, 'filename') || field(payload, 'name') || null;
    const content = field(payload, 'text') || field(payload, 'caption') || field(payload, 'title') ||
      fileName || `[${message.type.toUpperCase()}]`;
    return { kind: 'message' as const, id: message.id, phone, name: message.sender?.name || '',
      content, referral: message.referral || null, providerOccurredAt: providerTime(event.timestamp),
      mediaUrl: field(payload,'url') || null, mimeType: field(payload,'contentType') || field(payload,'content-type') || null, fileName,
      messageType: message.type === 'file' ? 'DOCUMENT' : message.type.toUpperCase(), sentAt: providerTime(event.timestamp) || new Date(), raw: message };
  }
  if (event.type === 'message-event') {
    const data = z.object({ id: z.string().min(1).max(191), gsId: z.string().max(191).optional(),
      type: z.string() }).parse(event.payload);
    const details = event.payload?.payload as Record<string, unknown> | undefined;
    return { kind: 'status' as const, id: data.id, gsId: data.gsId, status: data.type.toUpperCase(),
      occurredAt: providerTime(details?.ts, true) || providerTime(event.timestamp), failureCode: details?.code == null ? null : String(details.code).slice(0,32) };
  }
  return { kind: 'ignored' as const };
}

/** Retain the V2 envelope; only unwrap explicitly documented body/Cloud wrappers. */
export function normalizeProviderEnvelope(input: Record<string, unknown>): Record<string, unknown> {
  const body = input.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  const payload = input.payload;
  if (!input.type && payload && typeof payload === 'object' && !Array.isArray(payload) &&
    (payload as Record<string,unknown>).object === 'whatsapp_business_account') return payload as Record<string, unknown>;
  return input;
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
