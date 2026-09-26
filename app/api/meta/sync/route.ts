import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { z } from 'zod';
import { syncAds } from '@/services/meta-ads-service';
import { syncLeadForms } from '@/services/meta-form-service';
export const dynamic = 'force-dynamic';

/**
 * /api/meta/sync —— Settings 页「立即同步」按钮（管理员，需登录会话）
 * body: { kind?: 'all' | 'ads' | 'forms' }，默认 all
 */
const bodySchema = z.object({ kind: z.enum(['all', 'ads', 'forms']).default('all') });

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser(true);
    const { kind } = bodySchema.parse(await req.json().catch(() => ({})));
    const results: Record<string, unknown> = {};
    if (kind === 'ads' || kind === 'all') results.ads = await syncAds();
    if (kind === 'forms' || kind === 'all') results.forms = await syncLeadForms();
    return ok({ kind, results });
  });
}
