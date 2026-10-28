import { NextRequest } from 'next/server';
import { cronSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/**
 * The customer radar's scheduled job (POST, header x-cron-secret = META_SYNC_SECRET), every minute:
 *   curl -X POST -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/radar
 * Scores new prospects with DeepSeek and checks the addresses of the A and B ones, in small batches.
 */
export async function POST(req:NextRequest){
  if(!cronSecretValid(req.headers.get('x-cron-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{scoreProspects,verifyEmails},{handle,ok}]=await Promise.all([import('@/services/radar-scoring-service'),import('@/lib/http')]);
  return handle(async()=>ok({scoring:await scoreProspects(),verification:await verifyEmails()}));
}
