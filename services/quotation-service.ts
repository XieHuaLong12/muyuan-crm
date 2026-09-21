import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { accessible } from './customer-service';
import { syncCustomerWorkflow } from './workflow-service';
export async function createQuotation(input: unknown, user: Actor) {
  const v = z.object({ customerId:z.string().min(1),product:z.string().trim().min(1).max(180),quantity:z.number().int().positive().max(1000000),
    unitPrice:z.number().positive().max(100000000),currency:z.enum(['USD','EUR','CNY']),incoterm:z.enum(['FOB','DDP','EXW','CIF']),notes:z.string().max(4000).default('') }).parse(input);
  await accessible(v.customerId,user);
  return db.quotation.create({data:{...v,quoteNumber:`MY-${new Date().getFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`,createdBy:user.id}});
}
export async function markQuoteSent(id: string, user: Actor) {
  const quote = await db.quotation.findFirst({where:{id,customer:scope(user)}});
  if(!quote)throw new HttpError(404,'报价不存在');
  if(quote.status==='SENT')return quote;
  const sentAt=quote.sentAt||new Date();
  const saved=await db.$transaction(async tx=>{
    const q=await tx.quotation.update({where:{id},data:{status:'SENT',sentAt}});
    const c=await tx.customer.findUniqueOrThrow({where:{id:quote.customerId}});
    const stage=['WON','ORDER','LOST','INVALID','PAUSED','FOLLOW_UP'].includes(c.stage)?c.stage:'QUOTED';
    await tx.customer.update({where:{id:c.id},data:{stage,quotedAt:c.quotedAt||sentAt,...(quote.currency===c.currency?{quotedAmount:quote.unitPrice.mul(quote.quantity)}:{})}});
    if(stage!==c.stage)await tx.stageHistory.create({data:{customerId:c.id,fromStage:c.stage,toStage:stage,changedBy:user.id,note:`报价 ${quote.quoteNumber} 已发送`}});
    return q;
  });
  await syncCustomerWorkflow(quote.customerId);
  return saved;
}
