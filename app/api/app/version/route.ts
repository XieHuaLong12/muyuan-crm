import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { appVersion } from '@/services/mobile-app-service';
export const dynamic = 'force-dynamic';
/** GET ?platform=harmony|android: the newest internal build of LVANJUBOS (from the server environment), for 检查更新. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    return ok(appVersion(req.nextUrl.searchParams.get('platform')));
  });
}
