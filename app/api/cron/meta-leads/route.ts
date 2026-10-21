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
  const [{runLeadIntakeJob},{deliverLeadAlerts},{checkAnomalies,deliverDailyBrief},{reviewGradesWithAi},{outreachSweep},{deliverWeeklyScriptReport},{handle,ok}]=await Promise.all([import('@/services/meta-lead-intake-service'),import('@/services/lead-alert-service'),import('@/services/boss-brief-service'),import('@/services/lead-grade-service'),import('@/services/outreach-engine-service'),import('@/services/outreach-analytics-service'),import('@/lib/http')]);
  // Leads the poll brought in ring the phones too; alerts a webhook run could not deliver are sent here. Running
  // every 5 minutes, this is also what makes the overdue A/B lead alert and the 08:00 brief arrive on time, and lets
  // the AI read the leads the rules graded. The outreach sweep keeps touch records and reply judgements within 5
  // minutes of a sync, moves conversations on with time, and writes the Monday script conclusion before 09:00.
  return handle(async()=>{const intake=await runLeadIntakeJob();return ok({...intake,alerts:await deliverLeadAlerts(),anomalies:await checkAnomalies(),brief:await deliverDailyBrief(),aiGrades:await reviewGradesWithAi(),outreach:await outreachSweep(),scriptReport:await deliverWeeklyScriptReport()});});
}
