import { NextRequest } from 'next/server';
import { HttpError,requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { deleteMaterial,replaceMaterialFile,updateMaterial } from '@/services/sales-material-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{id:string}>};
// PATCH: name, category, language, product line. PUT (multipart file): 换新版. DELETE: remove from the library.
export async function PATCH(req:NextRequest,ctx:Ctx){return handle(async()=>{const user=await requireUser();return ok(await updateMaterial(user,(await ctx.params).id,await req.json()));});}
export async function PUT(req:NextRequest,ctx:Ctx){return handle(async()=>{
  const user=await requireUser();if(Number(req.headers.get('content-length'))>21*1024*1024)throw new HttpError(413,'文件不能超过 20 MB');
  const file=(await req.formData()).get('file');if(!(file instanceof File))throw new HttpError(400,'请选择文件');
  return ok(await replaceMaterialFile(user,(await ctx.params).id,file));
});}
export async function DELETE(_req:NextRequest,ctx:Ctx){return handle(async()=>{const user=await requireUser();return ok(await deleteMaterial(user,(await ctx.params).id));});}
