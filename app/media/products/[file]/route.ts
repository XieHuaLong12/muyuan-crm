import { NextRequest } from 'next/server';
import { currentUser,HttpError } from '@/lib/auth';
import { readProductImage } from '@/services/product-admin-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// 在产品库上传的产品图：地址每次上传都不同，可以长期缓存；只给登录用户。
export async function GET(_req:NextRequest,ctx:{params:Promise<{file:string}>}){
  if(!(await currentUser()))return new Response('请先登录',{status:401});
  try{const {file}=await ctx.params;const image=await readProductImage(file);
    return new Response(new Uint8Array(image.data),{headers:{'Content-Type':image.mimeType,'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
  }catch(error){if(error instanceof HttpError)return new Response(error.message,{status:error.status});throw error;}
}
