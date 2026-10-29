import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,HttpError,scope,requireAdmin } from '@/lib/auth';
import { dayKey,localDate } from '@/lib/time';
import { retryTransaction } from '@/lib/transaction-retry';
import { dealsIn, inquiryIn, isQualified, QUALIFIED, sentQuotesIn } from '@/lib/metrics';
import { TERMINAL_STAGES } from '@/lib/constants';
import { currentCustomers } from '@/lib/customer-group';

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
  const monthNumber=Number(selected.slice(5,7)),yearNumber=Number(selected.slice(0,4));
  // Counted up to now, like the cockpit, so a future-dated record cannot make the two pages disagree.
  const live={deletedAt:null},range={start,end:new Date(Math.min(now.getTime(),end.getTime()))};
  const [customers,deals,quotes,targets,assignments,pending,unassigned,closed,companyTarget,handover,deadlines,poolEntries,company]=await Promise.all([
    db.customer.findMany({where:{deletedAt:null,ownerId:{in:ids},...inquiryIn(range)},select:{id:true,ownerId:true,stage:true,isQualified:true,firstContactAt:true,contactedAt:true,assignedAt:true,firstContactDueAt:true,deals:{select:{dealDate:true}}}}),
    db.deal.findMany({where:{currency,...dealsIn(range,live),OR:[{salespersonId:{in:ids}},{salespersonId:null,customer:{ownerId:{in:ids},deletedAt:null}}]},select:{id:true,salespersonId:true,dealAmount:true,customer:{select:{ownerId:true}}}}),
    db.quotation.findMany({where:{...sentQuotesIn(range,live),createdBy:{in:ids}},select:{createdBy:true,customerId:true}}),
    db.userSalesTarget.findMany({where:{userId:{in:ids},month:selected,currency}}),
    db.customerAssignment.findMany({where:{toOwnerId:{in:ids},assignedAt:period,customer:{deletedAt:null}},select:{toOwnerId:true,customerId:true}}),
    db.customer.findMany({where:{...scope(user),ownerId:{in:ids},firstContactDueAt:{not:null},firstContactAt:null,contactedAt:null,lastOutboundAt:null,lastFollowUpAt:null,stage:{notIn:[...TERMINAL_STAGES]},AND:[currentCustomers]},select:{id:true,name:true,ownerId:true,firstContactDueAt:true},orderBy:{firstContactDueAt:'asc'}}),
    user.role==='ADMIN'?db.customer.count({where:{deletedAt:null,pendingAssignment:true,AND:[currentCustomers]}}):Promise.resolve(null),
    // Lead-quality judgements made by each salesperson this month, so administrators can review them.
    db.stageHistory.findMany({where:{changedBy:{in:ids},toStage:{in:['INVALID','PAUSED','LOST']},changedAt:period,customer:{deletedAt:null}},select:{changedBy:true,customerId:true}}),
    user.role==='ADMIN'?db.salesTarget.findUnique({where:{periodKey:`MONTH-${yearNumber}-${monthNumber}`},select:{targetRevenue:true,currency:true}}):Promise.resolve(null),
    user.role==='ADMIN'?db.user.findMany({where:{isActive:false,customers:{some:{deletedAt:null}}},select:{id:true,name:true,_count:{select:{customers:{where:{deletedAt:null}}}}}}):Promise.resolve([]),
    // First-contact deadlines started this month (5 minutes for fresh ad leads, hours otherwise).
    db.customer.findMany({where:{deletedAt:null,ownerId:{in:ids},assignedAt:period,firstContactDueAt:{not:null}},select:{ownerId:true,firstContactAt:true,firstContactDueAt:true}}),
    user.role==='ADMIN'?db.customerAssignment.findMany({where:{reason:{contains:'进入待分配池'},assignedAt:period},select:{customerId:true,assignedAt:true}}):Promise.resolve([]),
    // The whole company, counted exactly like the cockpit: includes unassigned customers and those an administrator owns.
    user.role==='ADMIN'?Promise.all([
      db.customer.count({where:{AND:[live,inquiryIn(range)]}}),
      db.customer.count({where:{AND:[live,inquiryIn(range),QUALIFIED]}}),
      db.deal.aggregate({where:{currency,...dealsIn(range,live)},_count:{_all:true},_sum:{dealAmount:true}}),
    ]):Promise.resolve(null),
  ]);
  // Time a pooled lead waited before an administrator assigned it.
  const poolAssignments=poolEntries.length?await db.customerAssignment.findMany({where:{customerId:{in:[...new Set(poolEntries.map(e=>e.customerId))]},NOT:{reason:{contains:'进入待分配池'}},assignedAt:{gte:start}},select:{customerId:true,assignedAt:true},orderBy:{assignedAt:'asc'}}):[];
  const waits=poolEntries.flatMap(entry=>{const next=poolAssignments.find(a=>a.customerId===entry.customerId&&a.assignedAt>entry.assignedAt);return next?[(next.assignedAt.getTime()-entry.assignedAt.getTime())/60000]:[];});
  const rows=users.map(person=>{
    const cohort=customers.filter(c=>c.ownerId===person.id),sales=deals.filter(d=>(d.salespersonId||d.customer.ownerId)===person.id),ownPending=pending.filter(c=>c.ownerId===person.id),target=targets.find(t=>t.userId===person.id);
    const revenue=sales.reduce((sum,d)=>sum.plus(d.dealAmount),new Prisma.Decimal(0));
    const response=cohort.filter(c=>c.assignedAt&&c.firstContactAt&&c.firstContactAt>=c.assignedAt).map(c=>(c.firstContactAt!.getTime()-c.assignedAt!.getTime())/60000);
    const won=cohort.filter(c=>c.deals.some(d=>d.dealDate>=start&&d.dealDate<end)).length;
    return {id:person.id,name:person.name,isActive:person.isActive,...(user.role==='ADMIN'?{email:person.email}:{}),newCustomers:cohort.length,assigned:new Set(assignments.filter(a=>a.toOwnerId===person.id).map(a=>a.customerId)).size,
      contacted:cohort.filter(c=>c.firstContactAt||c.contactedAt).length,qualified:cohort.filter(isQualified).length,
      quoted:new Set(quotes.filter(c=>c.createdBy===person.id).map(c=>c.customerId)).size,deals:sales.length,revenue:revenue.toFixed(2),legacyDeals:sales.filter(d=>!d.salespersonId).length,
      conversion:cohort.length?Math.round(won/cohort.length*1000)/10:null,averageFirstContactMinutes:response.length?Math.round(response.reduce((a,b)=>a+b,0)/response.length):null,
      pendingFirstContact:ownPending.length,overdueFirstContact:ownPending.filter(c=>c.firstContactDueAt!<now).length,
      closedByOwner:new Set(closed.filter(row=>row.changedBy===person.id).map(row=>row.customerId)).size,
      firstContactOnTime:(()=>{const own=deadlines.filter(d=>d.ownerId===person.id);const decided=own.filter(d=>d.firstContactAt||d.firstContactDueAt!<now);
        return decided.length?Math.round(decided.filter(d=>d.firstContactAt&&d.firstContactAt<=d.firstContactDueAt!).length/decided.length*1000)/10:null;})(),
      target:target?{amount:target.targetRevenue.toFixed(2),updatedAt:target.updatedAt.toISOString()}:null,
      completion:target&&target.targetRevenue.gt(0)?revenue.div(target.targetRevenue).mul(100).toDecimalPlaces(1).toNumber():null};
  });
  const personalTargets=targets.reduce((sum,t)=>sum.plus(t.targetRevenue),new Prisma.Decimal(0));
  const total=(field:'newCustomers'|'qualified'|'deals')=>rows.reduce((n,row)=>n+row[field],0);
  const companyTotals=company?{newCustomers:company[0],qualified:company[1],deals:company[2]._count._all,revenue:(company[2]._sum.dealAmount??new Prisma.Decimal(0)).toFixed(2)}:null;
  // What no salesperson owns yet (the pool and administrators' customers), so the rows add up to the company total.
  const others=companyTotals?{newCustomers:companyTotals.newCustomers-total('newCustomers'),qualified:companyTotals.qualified-total('qualified'),deals:companyTotals.deals-total('deals'),
    revenue:new Prisma.Decimal(companyTotals.revenue).minus(rows.reduce((sum,row)=>sum.plus(row.revenue),new Prisma.Decimal(0))).toFixed(2)}:null;
  return {month:selected,currency,timezone:settings.timezone,firstContactHours:settings.firstContactHours,adLeadFirstContactMinutes:settings.adLeadFirstContactMinutes,leadAssignMode:settings.leadAssignMode,rows,unassigned,company:companyTotals,others,
    targetSummary:user.role==='ADMIN'?{personal:personalTargets.toFixed(2),company:companyTarget&&companyTarget.currency===currency?companyTarget.targetRevenue.toFixed(2):null}:null,
    handover:handover.map(row=>({id:row.id,name:row.name,customers:row._count.customers})),
    poolWait:user.role==='ADMIN'?{assigned:waits.length,averageMinutes:waits.length?Math.round(waits.reduce((a,b)=>a+b,0)/waits.length*10)/10:null}:null,
    pending:pending.slice(0,100).map(c=>({id:c.id,name:c.name,ownerId:c.ownerId,dueAt:c.firstContactDueAt!.toISOString(),overdue:c.firstContactDueAt!<now})),pendingTotal:pending.length};
}
export type SalesPerformance=Awaited<ReturnType<typeof salesPerformance>>;

export async function saveSalesTarget(input:unknown,user:Actor){
  requireAdmin(user);const v=targetInput.parse(input);
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
  requireAdmin(user);
  const v=z.object({hours:z.coerce.number().int().min(1,'至少 1 小时').max(168,'最多 168 小时').optional(),
    adLeadMinutes:z.coerce.number().int().min(1,'广告线索至少 1 分钟').max(1440,'广告线索最多 1440 分钟').optional()}).parse(input);
  return db.$transaction(tx=>tx.setting.update({where:{id:'system'},data:{...(v.hours?{firstContactHours:v.hours}:{}),...(v.adLeadMinutes?{adLeadFirstContactMinutes:v.adLeadMinutes}:{})}}));
}
export async function firstContactFocus(user:Actor){
  // The top-bar numbers count 新客户 only; 旧客户 are handled on their own page (lib/customer-group).
  const where={...scope(user),stage:{notIn:[...TERMINAL_STAGES]},firstContactDueAt:{not:null},firstContactAt:null,contactedAt:null,lastOutboundAt:null,lastFollowUpAt:null,AND:[currentCustomers]};
  const [pending,overdue,pool]=await Promise.all([db.customer.count({where}),db.customer.count({where:{...where,firstContactDueAt:{lt:new Date()}}}),
    user.role==='ADMIN'?db.customer.count({where:{deletedAt:null,pendingAssignment:true,AND:[currentCustomers]}}):Promise.resolve(0)]);
  return {pending,overdue,pool};
}
