import { NextRequest } from 'next/server';
import { cronSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/**
 * Scheduled safety net for automatic tasks (POST, header x-cron-secret = META_SYNC_SECRET), e.g. hourly:
 *   curl -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/workflows
 * Business events already sync their own customer; this pass catches anything missed and computes
 * canonical contact keys for older customers in bounded batches.
 */
export async function POST(req:NextRequest){
  if(!cronSecretValid(req.headers.get('x-cron-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{syncAllWorkflows},{backfillContactKeys},{handle,ok}]=await Promise.all([import('@/services/workflow-service'),import('@/services/contact-identity-service'),import('@/lib/http')]);
  return handle(async()=>ok({contactKeys:await backfillContactKeys(500),workflows:await syncAllWorkflows()}));
}
