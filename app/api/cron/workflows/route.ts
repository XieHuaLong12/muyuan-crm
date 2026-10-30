import { NextRequest } from 'next/server';
import { cronSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/**
 * Scheduled safety net for automatic tasks (POST, header x-cron-secret = META_SYNC_SECRET), e.g. hourly:
 *   curl -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/workflows
 * Business events already sync their own customer; this pass catches anything missed and computes
 * canonical contact keys and blank countries (from WhatsApp numbers) for older customers in bounded batches.
 * It also sends the boss's morning brief (once a day, from 08:00) and the overdue-lead / lead-drop alerts, and processes
 * WhatsApp webhooks whose processing failed or stopped.
 */
export async function POST(req:NextRequest){
  if(!cronSecretValid(req.headers.get('x-cron-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{syncAllWorkflows},{backfillContactKeys},{fillMissingCountries},{gradeUngradedLeads,reviewGradesWithAi},{deliverLeadAlerts},{deliverDailyBrief,checkAnomalies},{outreachSweep},{deliverWeeklyScriptReport},{deliverReviewReminders},{retryWebhookReceipts},{handle,ok}]=await Promise.all([import('@/services/workflow-service'),import('@/services/contact-identity-service'),import('@/services/customer-country-service'),import('@/services/lead-grade-service'),import('@/services/lead-alert-service'),import('@/services/boss-brief-service'),import('@/services/outreach-engine-service'),import('@/services/outreach-analytics-service'),import('@/services/daily-review-service'),import('@/services/webhook-receipt-service'),import('@/lib/http')]);
  return handle(async()=>ok({webhooks:await retryWebhookReceipts(),contactKeys:await backfillContactKeys(500),countries:await fillMissingCountries(),grades:await gradeUngradedLeads(),aiGrades:await reviewGradesWithAi(),alerts:await deliverLeadAlerts(),workflows:await syncAllWorkflows(),anomalies:await checkAnomalies(),brief:await deliverDailyBrief(),outreach:await outreachSweep(),scriptReport:await deliverWeeklyScriptReport(),reviewReminders:await deliverReviewReminders()}));
}
