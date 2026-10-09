import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
export const dynamic='force-dynamic';

/**
 * Safety net for Meta ad leads (POST, header x-cron-secret = META_SYNC_SECRET), every 5 minutes:
 *   curl -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/meta-leads
 * Pulls leads the webhook did not deliver and retries failed imports whose back-off has elapsed.
 */
export async function POST(req:NextRequest){
  const supplied=req.headers.get('x-cron-secret')||'';const secret=process.env.META_SYNC_SECRET?.trim()||'';
  const left=Buffer.from(supplied),right=Buffer.from(secret);
  if(!secret||left.length!==right.length||!timingSafeEqual(left,right))return Response.json({success:false,error:'未授权'},{status:401});
  const [{runLeadIntakeJob},{handle,ok}]=await Promise.all([import('@/services/meta-lead-intake-service'),import('@/lib/http')]);
  return handle(async()=>ok(await runLeadIntakeJob()));
}
