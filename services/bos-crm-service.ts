import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,HttpError,scope } from '@/lib/auth';
import { retryTransaction } from '@/lib/transaction-retry';
import { KANBAN_STAGES,type KanbanStage } from '@/lib/bos-kanban';
const movable=KANBAN_STAGES.filter(item=>item.key!=='WON').map(item=>item.key);
const stagePatch=z.object({customerId:z.string().min(1),fromStage:z.string().min(1),toStage:z.enum(movable as [KanbanStage,...KanbanStage[]])});

export async function crmBoard(user:Actor){
 const where=scope(user);
 const [customers,total,counts]=await Promise.all([
  db.customer.findMany({where,select:{id:true,name:true,companyName:true,country:true,source:true,productInterest:true,quantity:true,estimatedOrderValue:true,currency:true,lastContactAt:true,nextFollowUpAt:true,aiNextAction:true,aiScore:true,stage:true},orderBy:[{nextFollowUpAt:'asc'},{updatedAt:'desc'}],take:500}),
  db.customer.count({where}),
  db.customer.groupBy({by:['stage'],where,_count:{_all:true}}),
 ]);
 return {total,limit:500,counts:Object.fromEntries(counts.map(c=>[c.stage,c._count._all])),customers:customers.map(c=>({...c,estimatedOrderValue:c.estimatedOrderValue.toFixed(2),lastContactAt:c.lastContactAt?.toISOString()??null,nextFollowUpAt:c.nextFollowUpAt?.toISOString()??null}))};
}
export type CrmBoard=Awaited<ReturnType<typeof crmBoard>>;

/** Compare-and-swap stage change so a stale board cannot overwrite newer CRM activity. */
export async function moveCustomerStage(user:Actor,input:unknown){
 const {customerId,fromStage,toStage}=stagePatch.parse(input);
 if(fromStage===toStage)return {stage:toStage};
 return retryTransaction(()=>db.$transaction(async tx=>{
  const current=await tx.customer.findFirst({where:{id:customerId,...scope(user)},select:{stage:true,contactedAt:true,firstReplyAt:true,needsConfirmedAt:true,quotedAt:true,deals:{select:{id:true},take:1}}});
  if(!current)throw new HttpError(404,'客户不存在或无权访问');
  if(current.stage!==fromStage)throw new HttpError(409,'客户阶段已更新，请刷新看板');
  if(current.deals.length||current.stage==='WON'||toStage==='WON')throw new HttpError(400,'成交客户必须通过新增成交记录推进，不支持直接拖拽');
  const stamp={CONTACTED:'contactedAt',REPLIED:'firstReplyAt',NEEDS_CONFIRMED:'needsConfirmedAt',QUOTED:'quotedAt'} as const;
  const field=stamp[toStage as keyof typeof stamp];
  const updated=await tx.customer.updateMany({where:{id:customerId,...scope(user),stage:fromStage},data:{stage:toStage,...(field&&!current[field]?{[field]:new Date()}:{}),...(toStage==='NEEDS_CONFIRMED'?{isQualified:true}:{})}});
  if(updated.count!==1)throw new HttpError(409,'客户阶段已更新，请刷新看板');
  await tx.stageHistory.create({data:{customerId,fromStage,toStage,changedBy:user.id,note:'CRM 看板移动'}});
  return {stage:toStage};
 }));
}
