import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { generateWhatsAppReply } from '@/services/whatsapp-ai-service';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { customerId, previous } = z.object({ customerId: z.string().min(1).max(191), previous: z.string().trim().max(4096).optional() }).parse(await req.json());
    return ok(await generateWhatsAppReply(customerId, user, previous || undefined));
  });
}
