import { NextRequest,NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle } from '@/lib/http';
import { accessible } from '@/services/customer-service';
import { readMedia,verifyMediaToken } from '@/services/whatsapp-media-service';
export const runtime='nodejs';
export async function GET(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{
  const {id}=await ctx.params;const signed=verifyMediaToken(id,req.nextUrl.searchParams.get('expires')||'',req.nextUrl.searchParams.get('token')||'');
  if(!signed){const user=await requireUser();const asset=await db.mediaAsset.findUniqueOrThrow({where:{id}});await accessible(asset.customerId,user);}
  const {asset,buffer}=await readMedia(id);
  return new NextResponse(new Uint8Array(buffer),{headers:{'Content-Type':asset.mimeType,'Content-Length':String(buffer.length),
    'Content-Disposition':`${asset.mimeType.startsWith('image/')||asset.mimeType.startsWith('audio/')||asset.mimeType.startsWith('video/')?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
    'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=300'}});
});}
