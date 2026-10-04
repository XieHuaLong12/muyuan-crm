import { ZodError } from 'zod';
import { HttpError } from '@/lib/auth';
import { normalizeProviderEnvelope } from '@/lib/gupshup';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsLeadgenEvent(payload: Record<string, unknown>) {
  return Array.isArray(payload.entry) && payload.entry.some(entry => isObject(entry) && Array.isArray(entry.changes)
    && entry.changes.some(change => isObject(change) && change.field === 'leadgen'));
}

const empty = (status: number) => new NextResponse(null, { status });

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  const accepted = [process.env.WHATSAPP_VERIFY_TOKEN, process.env.META_LEAD_WEBHOOK_SECRET]
    .filter((value): value is string => Boolean(value));
  // Meta subscription verification must still echo its authenticated challenge.
  if (mode === 'subscribe' && token && accepted.some(candidate => safeEqual(token, candidate))) {
    return new NextResponse(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return empty(204);
}

export async function HEAD() { return empty(204); }

export async function POST(req: NextRequest) {
  if (Number(req.headers.get('content-length') || 0) > 1_048_576) return empty(413);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 1_048_576) return empty(413);
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return empty(400);
    payload = normalizeProviderEnvelope(parsed);
  } catch { return empty(400); }

  const leadgen = containsLeadgenEvent(payload);
  if (leadgen) {
    const { verifyMetaSignature } = await import('@/services/meta-lead-service');
    if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256')).ok) return empty(401);
  } else if (payload.object === 'whatsapp_business_account' && typeof payload.gs_app_id !== 'string') {
    const appSecret = process.env.META_APP_SECRET?.trim();
    const signature = req.headers.get('x-hub-signature-256');
    if (!appSecret || !signature) return empty(401);
    const expected = `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`;
    if (!safeEqual(signature, expected)) return empty(401);
  } else {
    const secret = process.env.GUPSHUP_WEBHOOK_SECRET?.trim();
    if (!secret) return empty(503);
    const supplied = req.headers.get('x-webhook-secret') ?? req.nextUrl.searchParams.get('token') ?? '';
    if (!safeEqual(supplied, secret)) return empty(401);
    const app = process.env.GUPSHUP_APP_NAME?.trim();
    if (!app) return empty(503);
    if (typeof payload.gs_app_id === 'string'
      ? process.env.GUPSHUP_APP_ID && payload.gs_app_id !== process.env.GUPSHUP_APP_ID
      : payload.app !== app) return empty(400);
  }

  try {
    const { acceptWebhookReceipt, processWebhookReceipt } = await import('@/services/webhook-receipt-service');
    const id = await acceptWebhookReceipt(payload, leadgen ? 'META_LEADS' : 'WHATSAPP');
    after(() => processWebhookReceipt(id));
    return empty(200);
  } catch (error) {
    console.error('[Webhook Acceptance]', error instanceof HttpError ? error.status : error instanceof ZodError ? 'INVALID_PAYLOAD' : 'RECEIPT_SAVE_FAILED');
    return empty(error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 503);
  }
}
