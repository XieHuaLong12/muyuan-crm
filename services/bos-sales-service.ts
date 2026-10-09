import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,scope } from '@/lib/auth';
import { bosDateRange,opportunityStage } from '@/lib/bos';
export const salesQuery=z.object({queue:z.enum(['new','today','waiting','high','recent']).default('today'),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(10000).default(1)});
export async function salesQueue(user:Actor,input:unknown={},now=new Date()){
 const query=salesQuery.parse(input),settings=await db.setting.findUniqueOrThrow({where:{id:'system'}}),{end}=bosDateRange(now,settings.timezone);
 const active={stage:{notIn:['WON','LOST','INVALID','PAUSED']}};
 const filters:Record<typeof query.queue,Prisma.CustomerWhereInput>={new:{stage:{notIn:['WON','LOST','INVALID','PAUSED']},firstContactDueAt:{not:null},firstContactAt:null,contactedAt:null,lastOutboundAt:null,lastFollowUpAt:null},today:{...active,OR:[{stage:{notIn:['WON','LOST','INVALID','PAUSED']},firstContactDueAt:{not:null},firstContactAt:null,contactedAt:null,lastOutboundAt:null,lastFollowUpAt:null},{nextFollowUpAt:{lt:end}},{tasks:{some:{deletedAt:null,status:{not:'DONE'},dueDate:{lt:end}}}}]},waiting:{...active,lastInboundAt:{not:null},AND:[{OR:[{lastOutboundAt:null},{lastInboundAt:{gt:db.customer.fields.lastOutboundAt}}]},{OR:[{lastFollowUpAt:null},{lastInboundAt:{gt:db.customer.fields.lastFollowUpAt}}]}]},high:{...active,OR:[{aiScore:{gte:80}},{aiIntent:'HIGH'}]},recent:{}};
 const search:Prisma.CustomerWhereInput=query.q?{OR:[{name:{contains:query.q}},{companyName:{contains:query.q}},{country:{contains:query.q}},{whatsapp:{contains:query.q}}]}:{};
 const where={AND:[scope(user),filters[query.queue],search]};
 const [customers,total,counts]=await Promise.all([db.customer.findMany({where,select:{id:true,name:true,companyName:true,country:true,source:true,productInterest:true,stage:true,aiScore:true,aiIntent:true,aiNextAction:true,estimatedOrderValue:true,currency:true,lastContactAt:true,nextFollowUpAt:true,firstContactDueAt:true,firstContactAt:true,lastInboundAt:true,updatedAt:true},orderBy:query.queue==='new'?[{firstContactDueAt:'asc'},{id:'asc'}]:query.queue==='high'?[{aiScore:'desc'},{id:'asc'}]:[{updatedAt:'desc'},{id:'asc'}],take:50,skip:(query.page-1)*50}),db.customer.count({where}),Promise.all((['new','today','waiting','high','recent'] as const).map(async key=>({key,count:await db.customer.count({where:{AND:[scope(user),filters[key],search]}})})))]);
 return {query,total,pageSize:50,counts,customers:customers.map(c=>({...c,estimatedOrderValue:String(c.estimatedOrderValue),estimatedValue:String(c.estimatedOrderValue),leadScore:c.aiScore,opportunityStage:opportunityStage(c.stage),lastContactAt:c.lastContactAt?.toISOString()||null,nextFollowUpAt:c.nextFollowUpAt?.toISOString()||null,firstContactDueAt:c.firstContactDueAt?.toISOString()||null,firstContactAt:c.firstContactAt?.toISOString()||null,lastInboundAt:c.lastInboundAt?.toISOString()||null,updatedAt:c.updatedAt.toISOString()}))};
}
export type SalesQueueData=Awaited<ReturnType<typeof salesQueue>>;
