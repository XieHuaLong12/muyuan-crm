import { NextRequest,NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle } from '@/lib/http';
import { inlineMedia } from '@/services/whatsapp-media-service';
import { materialFile } from '@/services/sales-material-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** A 资料库 file for signed-in users: PDFs and pictures open in the browser, the rest download. */
export async function GET(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{
  await requireUser();const file=await materialFile((await ctx.params).id);
  const inline=inlineMedia(file.mimeType)||file.mimeType==='application/pdf';
  return new NextResponse(new Uint8Array(file.buffer),{headers:{'Content-Type':file.mimeType,'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    // Chrome will not show a PDF under a sandbox policy; nosniff keeps every other type from being read as a page.
    'X-Content-Type-Options':'nosniff',...(file.mimeType==='application/pdf'?{}:{'Content-Security-Policy':'sandbox'}),'Cache-Control':'private, max-age=60'}});
});}
