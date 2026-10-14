import { NextRequest } from 'next/server';
import { requireUser,HttpError } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { uploadMedia } from '@/services/whatsapp-media-service';
export const runtime='nodejs';
export async function POST(req:NextRequest){return handle(async()=>{
  const user=await requireUser();if(Number(req.headers.get('content-length'))>21*1024*1024)throw new HttpError(413,'文件不能超过 20 MB');
  const form=await req.formData();const file=form.get('file'),customerId=form.get('customerId');
  if(!(file instanceof File)||typeof customerId!=='string')throw new HttpError(400,'请选择客户和文件');
  return ok(await uploadMedia(file,customerId,user),201);
});}
