import { NextRequest } from 'next/server';
import { radarSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/** Today's keyword × city rows for the customer-radar crawler (header x-radar-secret = RADAR_INGEST_SECRET). */
export async function GET(req:NextRequest){
  if(!radarSecretValid(req.headers.get('x-radar-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{crawlPlan},{handle,ok}]=await Promise.all([import('@/services/radar-ingest-service'),import('@/lib/http')]);
  return handle(async()=>ok(await crawlPlan()));
}
