import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { listWhatsAppMessages } from '@/services/whatsapp-message-service';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const customerId = z.string().min(1).parse(req.nextUrl.searchParams.get('customerId'));
    return ok(await listWhatsAppMessages(customerId, user, req.nextUrl.searchParams.get('before') || undefined));
  });
}
