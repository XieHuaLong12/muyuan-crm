import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,HttpError,scope } from '@/lib/auth';
import { dayKey,localDate } from '@/lib/time';
import { retryTransaction } from '@/lib/transaction-retry';
import { requireManager } from './sales-account-service';

const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/,'请选择合法月份').refine(v=>Number(v.slice(0,4))>=2000&&Number(v.slice(0,4))<=2200,'月份超出范围');
const queryInput=z.object({month:month.optional(),currency:z.enum(['CNY','USD','EUR']).optional()});
const targetInput=z.object({userId:z.string().min(1).max(191),month,currency:z.enum(['CNY','USD','EUR']),targetRevenue:z.coerce.number().finite().min(0).max(999999999999.99).refine(v=>Math.abs(v*100-Math.round(v*100))<.001,'金额最多两位小数'),updatedAt:z.string().datetime({offset:true}).nullable().default(null)});

export async function salesPerformance(user:Actor,input:unknown={},now=new Date()){
  const q=queryInput.parse(input),settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
  const selected=q.month||dayKey(now,settings.timezone).slice(0,7),currency=q.currency||settings.currency;
  const start=localDate(`${selected}-01T00:00`,settings.timezone),next=new Date(`${selected}-01T12:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const end=localDate(`${next.toISOString().slice(0,10)}T00:00`,settings.timezone),period={gte:start,lt:end};
  const users=await db.user.findMany({where:user.role==='ADMIN'?{role:'SALES'}:{id:user.id},select:{id:true,name:true,email:true,isActive:true},orderBy:[{isActive:'desc'},{name:'asc'}]});
  const ids=users.map(row=>row.id);
  const [customers,deals,quotes,targets,assignments,pending,unassigned]=await Promise.all([
    db.customer.findMany({where:{deletedAt:null,ownerId:{in:ids},OR:[{inquiryAt:period},{inquiryAt:null,createdAt:period}]},select:{id:true,ownerId:true,isQualified:true,firstContactAt:true,contactedAt:true,assignedAt:true,firstContactDueAt:true,deals:{select:{dealDate:true}}}}),
    db.deal.findMany({where:{currency,dealDate:period,customer:{deletedAt:null},OR:[{salespersonId:{in:ids}},{salespersonId:null,customer:{ownerId:{in:ids},deletedAt:null}}]},select:{id:true,salespersonId:true,dealAmount:true,customer:{select:{ownerId:true}}}}),
    db.quotation.findMany({where:{status:'SENT',sentAt:period,createdBy:{in:ids},customer:{deletedAt:null}},select:{createdBy:true,customerId:true}}),
    db.userSalesTarget.findMany({where:{userId:{in:ids},month:selected,currency}}),
    db.customerAssignment.findMany({where:{toOwnerId:{in:ids},assignedAt:period,customer:{deletedAt:null}},select:{toOwnerId:true,customerId:true}}),
    db.customer.findMany({where:{...scope(user),ownerId:{in:ids},firstContactDueAt:{not:null},firstContactAt:null,contactedAt:null,lastOutboundAt:null,lastFollowUpAt:null,stage:{notIn:['WON','LOST','INVALID','PAUSED']}},select:{id:true,name:true,ownerId:true,firstContactDueAt:true},orderBy:{firstContactDueAt:'asc'}}),
    user.role==='ADMIN'?db.customer.count({where:{deletedAt:null,stage:'NEW',owner:{role:'ADMIN'}}}):Promise.resolve(null),
  ]);
  const rows=users.map(person=>{
    const cohort=customers.filter(c=>c.ownerId===person.id),sales=deals.filter(d=>(d.salespersonId||d.customer.ownerId)===person.id),ownPending=pending.filter(c=>c.ownerId===person.id),target=targets.find(t=>t.userId===person.id);
    const revenue=sales.reduce((sum,d)=>sum.plus(d.dealAmount),new Prisma.Decimal(0));
    const response=cohort.filter(c=>c.assignedAt&&c.firstContactAt&&c.firstContactAt>=c.assignedAt).map(c=>(c.firstContactAt!.getTime()-c.assignedAt!.getTime())/60000);
    const won=cohort.filter(c=>c.deals.some(d=>d.dealDate>=start&&d.dealDate<end)).length;
    return {id:person.id,name:person.name,isActive:person.isActive,...(user.role==='ADMIN'?{email:person.email}:{}),newCustomers:cohort.length,assigned:new Set(assignments.filter(a=>a.toOwnerId===person.id).map(a=>a.customerId)).size,
      contacted:cohort.filter(c=>c.firstContactAt||c.contactedAt).length,qualified:cohort.filter(c=>c.isQualified===true).length,
      quoted:new Set(quotes.filter(c=>c.createdBy===person.id).map(c=>c.customerId)).size,deals:sales.length,revenue:revenue.toFixed(2),legacyDeals:sales.filter(d=>!d.salespersonId).length,
      conversion:cohort.length?Math.round(won/cohort.length*1000)/10:null,averageFirstContactMinutes:response.length?Math.round(response.reduce((a,b)=>a+b,0)/response.length):null,
      pendingFirstContact:ownPending.length,overdueFirstContact:ownPending.filter(c=>c.firstContactDueAt!<now).length,
      target:target?{amount:target.targetRevenue.toFixed(2),updatedAt:target.updatedAt.toISOString()}:null,
      completion:target&&target.targetRevenue.gt(0)?revenue.div(target.targetRevenue).mul(100).toDecimalPlaces(1).toNumber():null};
  });
  return {month:selected,currency,timezone:settings.timezone,firstContactHours:settings.firstContactHours,rows,unassigned,
    pending:pending.slice(0,100).map(c=>({id:c.id,name:c.name,ownerId:c.ownerId,dueAt:c.firstContactDueAt!.toISOString(),overdue:c.firstContactDueAt!<now})),pendingTotal:pending.length};
}
export type SalesPerformance=Awaited<ReturnType<typeof salesPerformance>>;

export async function saveSalesTarget(input:unknown,user:Actor){
  requireManager(user);const v=targetInput.parse(input);
  return retryTransaction(()=>db.$transaction(async tx=>{
    if(!await tx.user.findFirst({where:{id:v.userId,role:'SALES',isActive:true}}))throw new HttpError(404,'销售账号不存在或已停用');
    const where={userId_month_currency:{userId:v.userId,month:v.month,currency:v.currency}},old=await tx.userSalesTarget.findUnique({where});
    if(old){
      if(!v.updatedAt||old.updatedAt.getTime()!==new Date(v.updatedAt).getTime())throw new HttpError(409,'目标已更新，请刷新后重试');
      const changed=await tx.userSalesTarget.updateMany({where:{id:old.id,updatedAt:new Date(v.updatedAt)},data:{targetRevenue:v.targetRevenue}});
      if(changed.count!==1)throw new HttpError(409,'目标已更新，请刷新后重试');
      return tx.userSalesTarget.findUniqueOrThrow({where});
    }
    if(v.updatedAt)throw new HttpError(409,'目标已变更，请刷新后重试');
    return tx.userSalesTarget.create({data:{userId:v.userId,month:v.month,currency:v.currency,targetRevenue:v.targetRevenue}});
  }));
}
export async function saveFirstContactPolicy(input:unknown,user:Actor){
  requireManager(user);const v=z.object({hours:z.coerce.number().int().min(1,'至少 1 小时').max(168,'最多 168 小时')}).parse(input);
  return db.$transaction(tx=>tx.setting.update({where:{id:'system'},data:{firstContactHours:v.hours}}));
}
export async function firstContactFocus(user:Actor){
  const where={...scope(user),stage:{notIn:['WON','LOST','INVALID','PAUSED']},firstContactDueAt:{not:null},firstContactAt:null,contactedAt:null,lastOutboundAt:null,lastFollowUpAt:null};
  const [pending,overdue]=await Promise.all([db.customer.count({where}),db.customer.count({where:{...where,firstContactDueAt:{lt:new Date()}}})]);
  return {pending,overdue};
}
