import { NextRequest } from 'next/server';
import { radarSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/** The crawler's run report: done, captcha or error (header x-radar-secret = RADAR_INGEST_SECRET). */
export async function POST(req:NextRequest){
  if(!radarSecretValid(req.headers.get('x-radar-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{reportCrawl},{handle,ok}]=await Promise.all([import('@/services/radar-ingest-service'),import('@/lib/http')]);
  return handle(async()=>ok(await reportCrawl(await req.json())));
}
