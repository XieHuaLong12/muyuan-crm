import { NextRequest } from 'next/server';
import { cronSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/**
 * Safety net for Meta ad leads (POST, header x-cron-secret = META_SYNC_SECRET), every 5 minutes:
 *   curl -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/meta-leads
 * Pulls leads the webhook did not deliver and retries failed imports whose back-off has elapsed.
 */
export async function POST(req:NextRequest){
  if(!cronSecretValid(req.headers.get('x-cron-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{runLeadIntakeJob},{deliverLeadAlerts},{checkAnomalies,deliverDailyBrief},{handle,ok}]=await Promise.all([import('@/services/meta-lead-intake-service'),import('@/services/lead-alert-service'),import('@/services/boss-brief-service'),import('@/lib/http')]);
  // Leads the poll brought in ring the phones too; alerts a webhook run could not deliver are sent here. Running
  // every 5 minutes, this is also what makes the overdue A/B lead alert and the 08:00 brief arrive on time.
  return handle(async()=>{const intake=await runLeadIntakeJob();return ok({...intake,alerts:await deliverLeadAlerts(),anomalies:await checkAnomalies(),brief:await deliverDailyBrief()});});
}
