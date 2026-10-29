import { NextRequest } from 'next/server';
import { requireUser,HttpError } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { uploadProductImage,PRODUCT_IMAGE } from '@/services/product-admin-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{
  const user=await requireUser();const {id}=await ctx.params;
  if(Number(req.headers.get('content-length'))>PRODUCT_IMAGE.maxBytes+64*1024)throw new HttpError(413,'图片不能超过 3 MB');
  const file=(await req.formData()).get('file');
  if(!(file instanceof File))throw new HttpError(400,'请选择图片');
  return ok(await uploadProductImage(user,id,file),201);
});}
