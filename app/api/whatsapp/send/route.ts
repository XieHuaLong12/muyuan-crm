import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { sendWhatsAppMessage } from '@/services/whatsapp-message-service';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser(true);
    return ok(await sendWhatsAppMessage(await req.json(), user, req.nextUrl.origin));
  });
}
