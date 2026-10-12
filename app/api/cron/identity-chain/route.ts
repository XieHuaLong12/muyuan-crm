import { NextRequest } from 'next/server';
import { cronSecretValid } from '@/lib/secret';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
  if(!cronSecretValid(req.headers.get('x-cron-secret')))return Response.json({success:false,error:'未授权'},{status:401});
  const [{identityMaintenance},{handle,ok}]=await Promise.all([import('@/services/identity-maintenance-service'),import('@/lib/http')]);
  return handle(async()=>ok(await identityMaintenance(await req.json())));
}
