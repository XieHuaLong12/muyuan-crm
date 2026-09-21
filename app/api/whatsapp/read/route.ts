import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle,ok } from '@/lib/http';
import { accessible } from '@/services/customer-service';
export async function POST(req:NextRequest){return handle(async()=>{
  const user=await requireUser();const {customerId,readAt}=z.object({customerId:z.string().min(1),readAt:z.string().datetime({offset:true})}).parse(await req.json());
  await accessible(customerId,user);const at=new Date(Math.min(Date.parse(readAt),Date.now()));
  await db.$transaction(async tx=>{await tx.whatsAppReadState.upsert({where:{customerId_userId:{customerId,userId:user.id}},create:{customerId,userId:user.id,readAt:at},update:{}});
    await tx.whatsAppReadState.updateMany({where:{customerId,userId:user.id,readAt:{lt:at}},data:{readAt:at}});});
  return ok({read:true});
});}
