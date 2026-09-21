import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,scope } from '@/lib/auth';
import { sources } from '@/lib/constants';
import { bosDateRange,channels } from '@/lib/bos';
export const growthQuery=z.object({tab:z.enum(['campaigns','leads','channels']).default('campaigns'),q:z.string().trim().max(100).default(''),source:z.string().refine(s=>s===''||s in sources).default(''),page:z.coerce.number().int().min(1).max(10000).default(1)});
export async function growthCenter(user:Actor,input:unknown={},now=new Date()){
 const query=growthQuery.parse(input),settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
 const {today}=bosDateRange(now,settings.timezone);const end=new Date(`${today}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+1);const since=new Date(end);since.setUTCDate(since.getUTCDate()-30);
 const where:Prisma.CustomerWhereInput={...scope(user),...(query.source?{source:query.source}:{}),...(query.q?{OR:[{name:{contains:query.q}},{companyName:{contains:query.q}},{country:{contains:query.q}}]}:{})};
 const [leads,total,sourceCounts,campaigns]=await Promise.all([
  db.customer.findMany({where,select:{id:true,name:true,companyName:true,country:true,source:true,createdAt:true,inquiryAt:true,productInterest:true,aiScore:true,stage:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(query.page-1)*50,take:50}),
  db.customer.count({where}),db.customer.groupBy({by:['source'],where:scope(user),_count:{_all:true}}),
  db.campaign.findMany({where:user.role==='ADMIN'?{}:{createdBy:user.id},include:{metrics:{where:{metricDate:{gte:since,lt:end}}}},orderBy:[{createdAt:'desc'},{id:'asc'}],take:100}),
 ]);
 const rows=campaigns.map(c=>{const spend=c.metrics.reduce((s,m)=>s.plus(m.spend),new Prisma.Decimal(0)),impressions=c.metrics.reduce((s,m)=>s+m.impressions,0),clicks=c.metrics.reduce((s,m)=>s+m.clicks,0),leads=c.metrics.reduce((s,m)=>s+m.leads,0),recorded=c.metrics.length>0;return {id:c.id,name:c.name,channel:c.channel,status:c.status,currency:c.currency,spend:recorded?spend.toFixed(2):null,impressions:recorded?impressions:null,clicks:recorded?clicks:null,leads:recorded?leads:null,ctr:recorded&&impressions>0?clicks/impressions*100:null,cpl:recorded&&leads>0?spend.div(leads).toFixed(2):null};});
 return {query,timezone:settings.timezone,scope:user.role==='ADMIN'?'TEAM':'PERSONAL',period:{from:since.toISOString(),to:end.toISOString()},leads:leads.map(c=>({...c,createdAt:c.createdAt.toISOString(),inquiryAt:c.inquiryAt?.toISOString()||null,leadScore:c.aiScore})),total,pageSize:50,campaigns:rows,campaignLimit:100,
  channels:channels.map(channel=>({channel,customerLeads:sourceCounts.find(c=>c.source===channel)?._count._all||0,connection:'NOT_CONNECTED' as const,campaigns:rows.filter(c=>c.channel===channel).length})),totalCustomers:sourceCounts.reduce((s,c)=>s+c._count._all,0)};
}
export type GrowthData=Awaited<ReturnType<typeof growthCenter>>;
