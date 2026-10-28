import { NextRequest } from 'next/server';
import { cronSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/**
 * The customer radar's scheduled job (POST, header x-cron-secret = META_SYNC_SECRET), every minute:
 *   curl -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/radar
 * Reads replies first (each mailbox every five minutes) so the sender knows who answered, moves sequences on with time,
 * sends (at most one mail per mailbox whose gap has passed, RADAR_SEND_ENABLED), then scores new prospects and checks
 * addresses, and rings phones for replies pushed into the customer center.
 */
export async function POST(req:NextRequest){
  if(!cronSecretValid(req.headers.get('x-cron-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{pollInboxes,processReplies,retryPushes,sweepSequences},{runSender},{scoreProspects,verifyEmails},{deliverLeadAlerts},{handle,ok}]=await Promise.all([
    import('@/services/radar-inbox-service'),import('@/services/radar-sender-service'),import('@/services/radar-scoring-service'),import('@/services/lead-alert-service'),import('@/lib/http')]);
  return handle(async()=>{
    const inbox=await pollInboxes();const replies=await processReplies();const pushes=await retryPushes();const sequences=await sweepSequences();
    const sending=await runSender();
    return ok({inbox,replies,pushes,sequences,sending,scoring:await scoreProspects(),verification:await verifyEmails(),alerts:await deliverLeadAlerts()});
  });
}
