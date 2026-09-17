import { NextRequest } from 'next/server';
import { requireUser, HttpError } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { completeWhatsAppEmbeddedSignup, whatsappConnectionStatus } from '@/services/whatsapp-connect-service';

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, '请求来源不受信任');
  }
  if (parsed.host !== req.headers.get('host') || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(403, '请求来源不受信任');
  }
}

export async function GET() {
  return handle(async () => {
    await requireUser(true);
    return ok(await whatsappConnectionStatus());
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    await requireUser(true);
    return ok(await completeWhatsAppEmbeddedSignup(await req.json()));
  });
}
