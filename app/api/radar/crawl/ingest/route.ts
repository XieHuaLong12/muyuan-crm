import { NextRequest } from 'next/server';
import { radarSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';

/** A batch of up to 50 map results with what was read on each site (header x-radar-secret = RADAR_INGEST_SECRET). */
export async function POST(req:NextRequest){
  if(!radarSecretValid(req.headers.get('x-radar-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{ingestProspects},{handle,ok}]=await Promise.all([import('@/services/radar-ingest-service'),import('@/lib/http')]);
  return handle(async()=>ok(await ingestProspects(await req.json())));
}
