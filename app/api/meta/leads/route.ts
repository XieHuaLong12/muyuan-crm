import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { metaLeadHealth, pollMetaLeads, subscribePageToLeadgen } from '@/services/meta-lead-intake-service';
import { retryPendingMetaLeads } from '@/services/meta-lead-service';
import { deliverLeadAlertsAfterResponse } from '@/lib/after-response';
export const dynamic = 'force-dynamic';

/** Ad lead intake status for administrators; ?live=1 also checks the Page token and leadgen subscription with Meta. */
export async function GET(req: NextRequest) {
  return handle(async () => ok(await metaLeadHealth(await requireUser(true), { live: req.nextUrl.searchParams.get('live') === '1' })));
}

const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('poll'), days: z.coerce.number().int().min(1).max(90).optional() }),
  z.object({ action: z.literal('retry') }),
  z.object({ action: z.literal('subscribe') }),
]);

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser(true);
    const v = action.parse(await req.json());
    if (v.action === 'poll') return ok(await pollMetaLeads({ days: v.days }));
    if (v.action === 'retry') { const retried = await retryPendingMetaLeads({ limit: 50 }, user); deliverLeadAlertsAfterResponse(); return ok(retried); }
    return ok(await subscribePageToLeadgen(user));
  });
}
