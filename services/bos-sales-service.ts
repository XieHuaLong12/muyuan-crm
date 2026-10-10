import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,scope } from '@/lib/auth';
import { bosDateRange,opportunityStage } from '@/lib/bos';

export const salesQuery=z.object({queue:z.enum(['new','today','waiting','high','recent']).default('today'),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1)});
type Queue=z.infer<typeof salesQuery>['queue'];

const ACTIVE:Prisma.CustomerWhereInput={stage:{notIn:['WON','LOST','INVALID','PAUSED']}};
// Assigned but nobody has contacted the customer yet.
const PENDING_FIRST_CONTACT:Prisma.CustomerWhereInput={firstContactDueAt:{not:null},firstContactAt:null,contactedAt:null,lastOutboundAt:null,lastFollowUpAt:null};
const openTaskDueBefore=(at:Date):Prisma.CustomerWhereInput=>({tasks:{some:{deletedAt:null,status:{not:'DONE'},dueDate:{lt:at}}}});
// Automated tasks that only restate the first-contact or follow-up date already shown on the row.
const RESTATED_TASKS=['first-contact:','follow:'];

/**
 * One definition of each work queue. The list, its tab counts, the sidebar badge and the top-bar number all use
 * it, so a salesperson sees the same "today" number everywhere.
 */
export function queueFilters(end:Date):Record<Queue,Prisma.CustomerWhereInput>{
 return {
  new:{...ACTIVE,...PENDING_FIRST_CONTACT},
  today:{...ACTIVE,OR:[PENDING_FIRST_CONTACT,{nextFollowUpAt:{lt:end}},openTaskDueBefore(end)]},
  waiting:{...ACTIVE,lastInboundAt:{not:null},AND:[{OR:[{lastOutboundAt:null},{lastInboundAt:{gt:db.customer.fields.lastOutboundAt}}]},{OR:[{lastFollowUpAt:null},{lastInboundAt:{gt:db.customer.fields.lastFollowUpAt}}]}]},
  high:{...ACTIVE,OR:[{aiScore:{gte:80}},{aiIntent:'HIGH'}]},
  recent:{},
 };
}
/** Today's work whose deadline has already passed. */
function overdueFilter(now:Date):Prisma.CustomerWhereInput{
 return {OR:[{...PENDING_FIRST_CONTACT,firstContactDueAt:{lt:now}},{nextFollowUpAt:{lt:now}},openTaskDueBefore(now)]};
}

/** The single "today" number for the top bar and sidebar: customers needing action today, and how many are late. */
export async function todayWorkCounts(user:Actor,now=new Date()){
 const {timezone}=await db.setting.findUniqueOrThrow({where:{id:'system'},select:{timezone:true}});
 const today={AND:[scope(user),queueFilters(bosDateRange(now,timezone).end).today]};
 const [count,overdue]=await Promise.all([db.customer.count({where:today}),db.customer.count({where:{AND:[today,overdueFilter(now)]}})]);
 return {today:count,todayOverdue:overdue};
}

const URGENT_LIMIT=500;
const select={id:true,name:true,companyName:true,country:true,source:true,productInterest:true,stage:true,aiScore:true,aiIntent:true,aiNextAction:true,estimatedOrderValue:true,currency:true,lastContactAt:true,nextFollowUpAt:true,firstContactDueAt:true,firstContactAt:true,lastInboundAt:true,updatedAt:true} satisfies Prisma.CustomerSelect;

export async function salesQueue(user:Actor,input:unknown={},now=new Date()){
 const query=salesQuery.parse(input),settings=await db.setting.findUniqueOrThrow({where:{id:'system'}}),{end}=bosDateRange(now,settings.timezone);
 const filters=queueFilters(end);
 const search:Prisma.CustomerWhereInput=query.q?{OR:[{name:{contains:query.q}},{companyName:{contains:query.q}},{country:{contains:query.q}},{whatsapp:{contains:query.q}}]}:{};
 const where={AND:[scope(user),filters[query.queue],search]};
 const pageSize=50,skip=(query.page-1)*pageSize;
 // Work queues are worked top-down, so they are ordered by deadline (the most overdue first), not by last edit.
 const urgent=query.queue==='today'||query.queue==='new';
 // Manual tasks have no automation key; NOT(NULL LIKE …) is not true in SQL, so they are matched explicitly.
 const tasks={where:{deletedAt:null,status:{not:'DONE'},dueDate:{lt:end},OR:[{automationKey:null},{NOT:RESTATED_TASKS.map(prefix=>({automationKey:{startsWith:prefix}}))}]},orderBy:{dueDate:'asc'},take:2,select:{title:true,dueDate:true}} satisfies Prisma.Customer$tasksArgs;
 const [rows,total,counts]=await Promise.all([
  db.customer.findMany({where,select:{...select,tasks},orderBy:query.queue==='high'?[{aiScore:'desc'},{id:'asc'}]:[{updatedAt:'desc'},{id:'asc'}],take:urgent?URGENT_LIMIT:pageSize,skip:urgent?0:skip}),
  db.customer.count({where}),
  Promise.all((['today','new','waiting','high'] as const).map(async key=>({key,count:await db.customer.count({where:{AND:[scope(user),filters[key],search]}})}))),
 ]);
 const deadlineOf=(c:(typeof rows)[number])=>{
  const pending=c.firstContactDueAt&&!c.firstContactAt?c.firstContactDueAt:null;
  return [pending,c.nextFollowUpAt,c.tasks[0]?.dueDate??null].filter((d):d is Date=>!!d).sort((a,b)=>a.getTime()-b.getTime())[0]??null;
 };
 const ordered=urgent?[...rows].sort((a,b)=>(deadlineOf(a)?.getTime()??Infinity)-(deadlineOf(b)?.getTime()??Infinity)||a.id.localeCompare(b.id)).slice(skip,skip+pageSize):rows;
 return {query,total,pageSize,counts,customers:ordered.map(c=>({...c,estimatedOrderValue:String(c.estimatedOrderValue),estimatedValue:String(c.estimatedOrderValue),leadScore:c.aiScore,opportunityStage:opportunityStage(c.stage),
  lastContactAt:c.lastContactAt?.toISOString()||null,nextFollowUpAt:c.nextFollowUpAt?.toISOString()||null,firstContactDueAt:c.firstContactDueAt?.toISOString()||null,firstContactAt:c.firstContactAt?.toISOString()||null,
  lastInboundAt:c.lastInboundAt?.toISOString()||null,updatedAt:c.updatedAt.toISOString(),
  // Other things due today for this customer (quote follow-up, payment, a manual to-do…), shown under the deadline.
  dueTasks:c.tasks.map(t=>({title:t.title,dueDate:t.dueDate.toISOString()}))}))};
}
export type SalesQueueData=Awaited<ReturnType<typeof salesQueue>>;
