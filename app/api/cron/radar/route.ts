import { NextRequest } from 'next/server';
import { cronSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/**
 * The customer radar's scheduled job (POST, header x-cron-secret = META_SYNC_SECRET), every minute:
 *   curl -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/radar
 * Scores new prospects with DeepSeek and checks the addresses of the A and B ones, in small batches, and runs the
 * sender: openings for new first mails, then at most one mail per mailbox whose gap has passed (RADAR_SEND_ENABLED).
 */
export async function POST(req:NextRequest){
  if(!cronSecretValid(req.headers.get('x-cron-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{scoreProspects,verifyEmails},{runSender},{handle,ok}]=await Promise.all([import('@/services/radar-scoring-service'),import('@/services/radar-sender-service'),import('@/lib/http')]);
  // Sending first: it is the part with a clock (gaps, recipients' hours); scoring and checks can wait a minute.
  return handle(async()=>{const sending=await runSender();return ok({sending,scoring:await scoreProspects(),verification:await verifyEmails()});});
}
