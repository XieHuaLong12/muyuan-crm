import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,HttpError,scope } from '@/lib/auth';
import { retryTransaction } from '@/lib/transaction-retry';
import { KANBAN_STAGES,KANBAN_REASON_STAGES,KANBAN_COLUMN_LIMIT,type KanbanStage } from '@/lib/bos-kanban';
const movable=KANBAN_STAGES.filter(item=>item.key!=='WON').map(item=>item.key);
const stagePatch=z.object({customerId:z.string().min(1),fromStage:z.string().min(1),toStage:z.enum(movable as [KanbanStage,...KanbanStage[]]),reason:z.string().trim().max(190).default('')});
const cardSelect={id:true,name:true,companyName:true,country:true,source:true,productInterest:true,quantity:true,estimatedOrderValue:true,currency:true,lastContactAt:true,nextFollowUpAt:true,aiNextAction:true,aiScore:true,stage:true} as const;

/** Every stage is its own column with its own page, so a large customer base never hides whole stages. */
export async function crmBoard(user:Actor){
 const where=scope(user);
 const [columns,counts]=await Promise.all([
  Promise.all(KANBAN_STAGES.map(column=>db.customer.findMany({where:{...where,stage:column.key},select:cardSelect,orderBy:[{nextFollowUpAt:{sort:'asc',nulls:'last'}},{updatedAt:'desc'}],take:KANBAN_COLUMN_LIMIT}))),
  db.customer.groupBy({by:['stage'],where,_count:{_all:true}}),
 ]);
 const total=counts.reduce((sum,row)=>sum+row._count._all,0);
 return {total,limit:KANBAN_COLUMN_LIMIT,counts:Object.fromEntries(counts.map(c=>[c.stage,c._count._all])),customers:columns.flat().map(c=>({...c,estimatedOrderValue:c.estimatedOrderValue.toFixed(2),lastContactAt:c.lastContactAt?.toISOString()??null,nextFollowUpAt:c.nextFollowUpAt?.toISOString()??null}))};
}
export type CrmBoard=Awaited<ReturnType<typeof crmBoard>>;

/** Compare-and-swap stage change (kanban and customer list) so a stale page cannot overwrite newer CRM activity. */
export async function moveCustomerStage(user:Actor,input:unknown){
 const {customerId,fromStage,toStage,reason}=stagePatch.parse(input);
 if(fromStage===toStage)return {stage:toStage};
 if(KANBAN_REASON_STAGES.includes(toStage)&&reason.length<2)throw new HttpError(400,'改为暂不需要、已流失或无效客户时，请填写原因');
 const result=await retryTransaction(()=>db.$transaction(async tx=>{
  const current=await tx.customer.findFirst({where:{id:customerId,...scope(user)},select:{stage:true,contactedAt:true,firstReplyAt:true,needsConfirmedAt:true,quotedAt:true,lostAt:true,deals:{select:{id:true},take:1}}});
  if(!current)throw new HttpError(404,'客户不存在或无权访问');
  if(current.stage!==fromStage)throw new HttpError(409,'客户阶段已被其他人更新，请刷新后再改');
  if(current.deals.length||current.stage==='WON'||toStage==='WON')throw new HttpError(400,'成交请在客户档案里「新增成交」登记，不能直接改阶段');
  const stamp={CONTACTED:'contactedAt',REPLIED:'firstReplyAt',NEEDS_CONFIRMED:'needsConfirmedAt',QUOTED:'quotedAt',LOST:'lostAt'} as const;
  const field=stamp[toStage as keyof typeof stamp];
  const withReason=KANBAN_REASON_STAGES.includes(toStage);
  const updated=await tx.customer.updateMany({where:{id:customerId,...scope(user),stage:fromStage},data:{stage:toStage,stageSource:'HUMAN',...(field&&!current[field]?{[field]:new Date()}:{}),...(toStage==='NEEDS_CONFIRMED'?{isQualified:true}:{}),...(toStage==='INVALID'?{isQualified:false}:{}),...(withReason?{invalidReason:reason}:{})}});
  if(updated.count!==1)throw new HttpError(409,'客户阶段已被其他人更新，请刷新后再改');
  await tx.stageHistory.create({data:{customerId,fromStage,toStage,changedBy:user.id,note:withReason?`CRM 看板移动：${reason}`.slice(0,190):'CRM 看板移动'}});
  if(toStage==='CONTACTED')await (await import('./workflow-service')).recordFirstContact(tx,customerId,current.contactedAt||new Date(),user.id);
  return {stage:toStage};
 }));
 // Paused, lost and invalid customers close their open rule tasks right away.
 await (await import('./workflow-service')).syncCustomerWorkflow(customerId);
 return result;
}
