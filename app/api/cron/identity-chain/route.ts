import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
  const supplied=req.headers.get('x-cron-secret')||'';const secret=process.env.META_SYNC_SECRET?.trim()||'';
  const left=Buffer.from(supplied),right=Buffer.from(secret);
  if(!secret||left.length!==right.length||!timingSafeEqual(left,right))return Response.json({success:false,error:'未授权'},{status:401});
  const [{identityMaintenance},{handle,ok}]=await Promise.all([import('@/services/identity-maintenance-service'),import('@/lib/http')]);
  return handle(async()=>ok(await identityMaintenance(await req.json())));
}
