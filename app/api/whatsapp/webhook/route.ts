import { ZodError } from 'zod';
import { HttpError } from '@/lib/auth';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { syncCustomerWorkflow } from '@/services/workflow-service';
import { updateWhatsAppStage } from '@/services/whatsapp-stage-service';
import { after, NextRequest, NextResponse } from 'next/server';
import { ingestWhatsAppWebhook } from '@/services/whatsapp-webhook-service';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return (
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
}

/**
 * Meta webhook verification
 * Gupshup health check fallback
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode') ?? '';
  const token = req.nextUrl.searchParams.get('hub.verify_token') ?? '';
  const challenge = req.nextUrl.searchParams.get('hub.challenge') ?? '';
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? '';

  if (
    mode === 'subscribe' &&
    expected &&
    safeEqual(token, expected)
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  return NextResponse.json({
    success: true,
    message: 'Webhook ready',
  });
}

/**
 * Receive WhatsApp messages
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid JSON payload',
      },
      { status: 400 }
    );
  }

  const isMetaWebhook = !!payload && typeof payload === 'object' && 'object' in payload && payload.object === 'whatsapp_business_account';
  if (!isMetaWebhook) {
    const secret = process.env.GUPSHUP_WEBHOOK_SECRET?.trim();
    if (secret && !safeEqual(req.nextUrl.searchParams.get('token') || req.headers.get('x-webhook-secret') || '', secret)) {
      return NextResponse.json({ success: false, error: 'Invalid webhook token' }, { status: 401 });
    }
    const app = process.env.GUPSHUP_APP_NAME?.trim();
    if (app && (!payload || typeof payload !== 'object' || !('app' in payload) || payload.app !== app)) {
      return NextResponse.json({ success: false, error: 'Unexpected Gupshup app' }, { status: 400 });
    }
  }

  if (isMetaWebhook) {
    const appSecret = process.env.META_APP_SECRET?.trim();

    if (!appSecret) {
      return NextResponse.json(
        {
          success: false,
          error: 'META_APP_SECRET is not configured',
        },
        { status: 503 }
      );
    }

    const signature = req.headers.get('x-hub-signature-256') ?? '';

    const expected = `sha256=${createHmac('sha256', appSecret)
      .update(raw)
      .digest('hex')}`;

    if (!signature || !safeEqual(signature, expected)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid webhook signature',
        },
        { status: 401 }
      );
    }
  }

  try {
    const result = await ingestWhatsAppWebhook(
      payload as Parameters<typeof ingestWhatsAppWebhook>[0]
    );

    after(async () => {
      for (const customerId of new Set(result.customerIds)) {
        try { await syncCustomerWorkflow(customerId); await updateWhatsAppStage(customerId); }
        catch { console.error('WhatsApp AI stage processing failed; message remains pending', customerId); }
      }
    });
    const { customerIds, ...counts } = result;
    void customerIds;
    return NextResponse.json({ success: true, ...counts });
  } catch (error) {
    if (error instanceof ZodError || error instanceof HttpError) {
      return NextResponse.json({ success: false, error: error instanceof ZodError ? 'Invalid webhook payload' : error.message }, { status: error instanceof ZodError ? 400 : error.status });
    }
    console.error(
      'WhatsApp webhook ingestion failed',
      error
    );

    return NextResponse.json(
      {
        success: false,
        error: 'Webhook processing failed',
      },
      { status: 500 }
    );
  }
}
