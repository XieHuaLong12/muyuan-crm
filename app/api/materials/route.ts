import { NextRequest } from 'next/server';
import { HttpError,requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { listMaterials,uploadMaterial } from '@/services/sales-material-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// 资料库: everyone may list; administrators upload (multipart: file, title, category, language, productLine, sort).
export async function GET(){return handle(async()=>{await requireUser();return ok(await listMaterials());});}
export async function POST(req:NextRequest){return handle(async()=>{
  const user=await requireUser();if(Number(req.headers.get('content-length'))>21*1024*1024)throw new HttpError(413,'文件不能超过 20 MB');
  const form=await req.formData();const file=form.get('file');if(!(file instanceof File))throw new HttpError(400,'请选择文件');
  const fields=Object.fromEntries([...form.entries()].filter(([key,value])=>key!=='file'&&typeof value==='string'));
  return ok(await uploadMaterial(user,file,fields),201);
});}
