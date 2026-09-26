import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { metaAdsStatus } from '@/services/meta-ads-service';
import { metaFormsStatus } from '@/services/meta-form-service';
export const dynamic = 'force-dynamic';

/** /api/meta/status —— Settings 页展示 Meta 广告账户与表单目录的同步状态（管理员）。 */
export async function GET() {
  return handle(async () => {
    await requireUser(true);
    const [ads, forms] = await Promise.all([metaAdsStatus(), metaFormsStatus()]);
    return ok({ ads, forms });
  });
}
