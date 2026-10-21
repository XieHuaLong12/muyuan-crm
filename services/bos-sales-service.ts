import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,scope } from '@/lib/auth';
import { bosDateRange,opportunityStage } from '@/lib/bos';
import { TERMINAL_STAGES } from '@/lib/constants';
import { STALE_QUOTE_DAYS } from '@/lib/metrics';
import { buyerLabel, isBusinessBuyer } from '@/lib/lead-grade';

export const salesQuery=z.object({queue:z.enum(['new','today','waiting','high','recent']).default('today'),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1)});
type Queue=z.infer<typeof salesQuery>['queue'];

const ACTIVE:Prisma.CustomerWhereInput={stage:{notIn:[...TERMINAL_STAGES]}};
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
const span=(minutes:number)=>minutes<60?`${Math.max(1,Math.round(minutes))} 分钟`:minutes<1440?`${Math.round(minutes/60)} 小时`:`${Math.round(minutes/1440)} 天`;
type Signals={deadline:Date|null;firstContactPending:boolean;leadGrade:string;purchaseType?:string;aiIntent:string;aiScore:number;bestReplyQuality?:string;lastInboundAt:Date|null;lastOutboundAt:Date|null;lastFollowUpAt:Date|null;lastContactAt:Date|null;staleQuoteSentAt:Date|null};
/**
 * Where a customer belongs in today's work, and why. A missed deadline weighs most and grows with the delay; then
 * what makes the customer worth the next minute: the customer is waiting for an answer, a good ad form (an A lead due
 * soon goes before a follow-up that just slipped), high buying intent, a quotation going cold. Rules, not a model,
 * so the order is instant and explainable.
 */
export function workPriority(c:Signals,now=new Date()){
 let score=0;const reasons:string[]=[];
 if(c.deadline){
  const late=(now.getTime()-c.deadline.getTime())/60_000;
  if(late>0){score+=60+Math.min(48*60,late)/60;reasons.push(`${c.firstContactPending?'首联':'跟进'}已超时 ${span(late)}`);}
  else{score+=30+Math.max(0,12+late/60);reasons.push(c.firstContactPending?`${span(-late)}内首次联系`:'今天到期');}
 }
 const answered=Math.max(c.lastOutboundAt?.getTime()??0,c.lastFollowUpAt?.getTime()??0);
 if(c.lastInboundAt&&c.lastInboundAt.getTime()>answered){score+=20;reasons.push(`客户在等回复 ${span((now.getTime()-c.lastInboundAt.getTime())/60_000)}`);}
 // Identity first: within B, a buyer with a business identity ("B + 身份") goes before one without.
 const identity=isBusinessBuyer(c.purchaseType??'')?buyerLabel(c.purchaseType!):'';
 if(c.leadGrade==='A'){score+=25;reasons.push(identity?`A 级 · ${identity}`:'A 级表单');}
 else if(c.leadGrade==='B'){score+=identity?14:8;reasons.push(identity?`B 级 · ${identity}`:'B 级表单');}
 else if(c.leadGrade==='D'){score-=30;reasons.push('D 级表单');}
 if(c.aiIntent==='HIGH'||c.aiScore>=80){score+=12;reasons.push('AI 判断高意向');}
 else if(c.bestReplyQuality==='HIGH'){score+=12;reasons.push('回复出现采购信号');}
 if(c.staleQuoteSentAt&&(!c.lastContactAt||c.lastContactAt<new Date(now.getTime()-STALE_QUOTE_DAYS*86_400_000))){score+=10;reasons.push(`报价 ${span((now.getTime()-c.staleQuoteSentAt.getTime())/60_000)}未回复`);}
 return {score:Math.round(score*10)/10,reasons};
}
const select={id:true,name:true,companyName:true,country:true,source:true,productInterest:true,stage:true,aiScore:true,aiIntent:true,aiNextAction:true,estimatedOrderValue:true,currency:true,lastContactAt:true,nextFollowUpAt:true,firstContactDueAt:true,firstContactAt:true,lastInboundAt:true,lastOutboundAt:true,lastFollowUpAt:true,leadGrade:true,purchaseType:true,leadGradeReason:true,bestReplyQuality:true,updatedAt:true} satisfies Prisma.CustomerSelect;

export async function salesQueue(user:Actor,input:unknown={},now=new Date()){
 const query=salesQuery.parse(input),settings=await db.setting.findUniqueOrThrow({where:{id:'system'}}),{end}=bosDateRange(now,settings.timezone);
 const filters=queueFilters(end);
 const search:Prisma.CustomerWhereInput=query.q?{OR:[{name:{contains:query.q}},{companyName:{contains:query.q}},{country:{contains:query.q}},{whatsapp:{contains:query.q}}]}:{};
 const where={AND:[scope(user),filters[query.queue],search]};
 const pageSize=50,skip=(query.page-1)*pageSize;
 // Work queues are ranked (workPriority); the other queues keep their own order.
 const urgent=query.queue==='today'||query.queue==='new';
 // Manual tasks have no automation key; NOT(NULL LIKE …) is not true in SQL, so they are matched explicitly.
 const tasks={where:{deletedAt:null,status:{not:'DONE'},dueDate:{lt:end},OR:[{automationKey:null},{NOT:RESTATED_TASKS.map(prefix=>({automationKey:{startsWith:prefix}}))}]},orderBy:{dueDate:'asc'},take:2,select:{title:true,dueDate:true}} satisfies Prisma.Customer$tasksArgs;
 const [rows,total,counts]=await Promise.all([
  db.customer.findMany({where,select:{...select,tasks,quotations:{where:{status:'SENT',sentAt:{lt:new Date(now.getTime()-STALE_QUOTE_DAYS*86_400_000)}},orderBy:{sentAt:'asc'},take:1,select:{sentAt:true}}},orderBy:query.queue==='high'?[{aiScore:'desc'},{id:'asc'}]:[{updatedAt:'desc'},{id:'asc'}],take:urgent?URGENT_LIMIT:pageSize,skip:urgent?0:skip}),
  db.customer.count({where}),
  Promise.all((['today','new','waiting','high'] as const).map(async key=>({key,count:await db.customer.count({where:{AND:[scope(user),filters[key],search]}})}))),
 ]);
 const deadlineOf=(c:(typeof rows)[number])=>{
  const pending=c.firstContactDueAt&&!c.firstContactAt?c.firstContactDueAt:null;
  return [pending,c.nextFollowUpAt,c.tasks[0]?.dueDate??null].filter((d):d is Date=>!!d).sort((a,b)=>a.getTime()-b.getTime())[0]??null;
 };
 const ranked=rows.map(c=>({c,...workPriority({deadline:deadlineOf(c),firstContactPending:!!c.firstContactDueAt&&!c.firstContactAt,leadGrade:c.leadGrade,purchaseType:c.purchaseType,aiIntent:c.aiIntent,aiScore:c.aiScore,bestReplyQuality:c.bestReplyQuality,
  lastInboundAt:c.lastInboundAt,lastOutboundAt:c.lastOutboundAt,lastFollowUpAt:c.lastFollowUpAt,lastContactAt:c.lastContactAt,staleQuoteSentAt:c.quotations[0]?.sentAt??null},now)}));
 // Work queues are worked top-down: the highest priority first, the earliest deadline breaking ties.
 const ordered=urgent?ranked.sort((a,b)=>b.score-a.score||(deadlineOf(a.c)?.getTime()??Infinity)-(deadlineOf(b.c)?.getTime()??Infinity)||a.c.id.localeCompare(b.c.id)).slice(skip,skip+pageSize):ranked;
 return {query,total,pageSize,counts,customers:ordered.map(({c,score,reasons})=>({...c,priority:score,reasons,quotations:undefined,lastOutboundAt:c.lastOutboundAt?.toISOString()||null,lastFollowUpAt:c.lastFollowUpAt?.toISOString()||null,estimatedOrderValue:String(c.estimatedOrderValue),estimatedValue:String(c.estimatedOrderValue),leadScore:c.aiScore,opportunityStage:opportunityStage(c.stage),
  lastContactAt:c.lastContactAt?.toISOString()||null,nextFollowUpAt:c.nextFollowUpAt?.toISOString()||null,firstContactDueAt:c.firstContactDueAt?.toISOString()||null,firstContactAt:c.firstContactAt?.toISOString()||null,
  lastInboundAt:c.lastInboundAt?.toISOString()||null,updatedAt:c.updatedAt.toISOString(),
  // Other things due today for this customer (quote follow-up, payment, a manual to-do…), shown under the deadline.
  dueTasks:c.tasks.map(t=>({title:t.title,dueDate:t.dueDate.toISOString()}))}))};
}
export type SalesQueueData=Awaited<ReturnType<typeof salesQueue>>;
