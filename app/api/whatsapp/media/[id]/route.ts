import { NextRequest,NextResponse } from 'next/server';
import { HttpError,requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle } from '@/lib/http';
import { accessible } from '@/services/customer-service';
import { inlineMedia,readMedia,verifyMediaToken } from '@/services/whatsapp-media-service';
export const runtime='nodejs';
export async function GET(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{
  const {id}=await ctx.params;const signed=verifyMediaToken(id,req.nextUrl.searchParams.get('expires')||'',req.nextUrl.searchParams.get('token')||'');
  if(!signed){const user=await requireUser();const asset=await db.mediaAsset.findUnique({where:{id},select:{customerId:true}});if(!asset)throw new HttpError(404,'文件不存在');await accessible(asset.customerId,user);}
  const {asset,buffer}=await readMedia(id);
  const headers:Record<string,string>={'Content-Type':asset.mimeType,'Accept-Ranges':'bytes',
    'Content-Disposition':`${inlineMedia(asset.mimeType)?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
    'X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox','Cache-Control':'private, max-age=300'};
  // Safari only plays audio and video that can be fetched in byte ranges.
  const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range')||'');
  if(range&&(range[1]||range[2])){
    const size=buffer.length,start=range[1]?Number(range[1]):Math.max(0,size-Number(range[2])),end=range[1]&&range[2]?Math.min(Number(range[2]),size-1):size-1;
    if(start>=size||start>end)return new NextResponse(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    return new NextResponse(new Uint8Array(buffer.subarray(start,end+1)),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':String(end-start+1)}});
  }
  return new NextResponse(new Uint8Array(buffer),{headers:{...headers,'Content-Length':String(buffer.length)}});
});}
