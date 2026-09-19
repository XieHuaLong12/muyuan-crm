import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
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

  const isMetaWebhook = req.headers.has('x-hub-signature-256');

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
    console.log(
      'WhatsApp webhook payload:',
      JSON.stringify(payload)
    );

    const result = await ingestWhatsAppWebhook(
      payload as Parameters<typeof ingestWhatsAppWebhook>[0]
    );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
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
