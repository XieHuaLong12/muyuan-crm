import { Prisma } from '@prisma/client';
import { quotationAmount } from '@/lib/quotation-amount';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,scope } from '@/lib/auth';
import { sources } from '@/lib/constants';
import { channels } from '@/lib/bos';
import { growthPeriod,growthPeriodQuery } from '@/lib/growth-period';
export const growthQuery=z.object({tab:z.enum(['campaigns','leads','channels']).default('campaigns'),q:z.string().trim().max(100).default(''),source:z.string().refine(s=>s===''||s in sources).default(''),page:z.coerce.number().int().min(1).max(10000).default(1)}).merge(growthPeriodQuery);
export async function growthCenter(user:Actor,input:unknown={},now=new Date()){
 const query=growthQuery.parse(input),settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
 const period=growthPeriod(query,now,settings.timezone);const {start,end,metricStart,metricEnd}=period;
 const where:Prisma.CustomerWhereInput={...scope(user),createdAt:{gte:start,lt:end},...(query.source?{source:query.source}:{}),...(query.q?{OR:[{name:{contains:query.q}},{companyName:{contains:query.q}},{country:{contains:query.q}}]}:{})};
 const [leads,total,sourceCounts,campaigns,qualified,quotes,deals,allMetrics]=await Promise.all([
  db.customer.findMany({where,select:{id:true,name:true,companyName:true,country:true,source:true,createdAt:true,inquiryAt:true,productInterest:true,aiScore:true,stage:true},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(query.page-1)*50,take:50}),
  db.customer.count({where}),db.customer.groupBy({by:['source'],where:{...scope(user),createdAt:{gte:start,lt:end}},_count:{_all:true}}),
  db.campaign.findMany({where:user.role==='ADMIN'?{}:{createdBy:user.id},include:{metrics:{where:{metricDate:{gte:metricStart,lt:metricEnd}}}},orderBy:[{createdAt:'desc'},{id:'asc'}],take:100}),
  db.customer.count({where:{...scope(user),createdAt:{gte:start,lt:end},isQualified:true}}),
  db.quotation.findMany({where:{customer:scope(user),sentAt:{gte:start,lt:end}},select:{currency:true,unitPrice:true,quantity:true,totalAmount:true}}),
  db.deal.findMany({where:{customer:scope(user),dealDate:{gte:start,lt:end}},select:{currency:true,dealAmount:true,grossProfit:true}}),
  db.marketingMetric.findMany({where:{metricDate:{gte:metricStart,lt:metricEnd},campaign:user.role==='ADMIN'?{}:{createdBy:user.id}},select:{spend:true,leads:true,campaign:{select:{currency:true}}}}),
 ]);
 const rows=campaigns.map(c=>{const spend=c.metrics.reduce((s,m)=>s.plus(m.spend),new Prisma.Decimal(0)),impressions=c.metrics.reduce((s,m)=>s+m.impressions,0),clicks=c.metrics.reduce((s,m)=>s+m.clicks,0),leads=c.metrics.reduce((s,m)=>s+m.leads,0),recorded=c.metrics.length>0;return {id:c.id,name:c.name,channel:c.channel,status:c.status,currency:c.currency,synced:Boolean(c.externalId),spend:recorded?spend.toFixed(2):null,impressions:recorded?impressions:null,clicks:recorded?clicks:null,leads:recorded?leads:null,ctr:recorded&&impressions>0?clicks/impressions*100:null,cpl:recorded&&leads>0?spend.div(leads).toFixed(2):null};});
 const money=(items:{currency:string;amount:Prisma.Decimal}[])=>Object.entries(items.reduce<Record<string,Prisma.Decimal>>((value,item)=>{value[item.currency]=(value[item.currency]??new Prisma.Decimal(0)).plus(item.amount);return value;},{})).map(([currency,amount])=>({currency,amount:amount.toFixed(2)}));
 const spend=money(allMetrics.map(row=>({currency:row.campaign.currency,amount:row.spend})));
 return {query,timezone:settings.timezone,scope:user.role==='ADMIN'?'TEAM':'PERSONAL',period:{from:start.toISOString(),to:end.toISOString(),startDate:period.startDate,endDate:period.endDate},summary:{spend,adLeads:allMetrics.reduce((n,row)=>n+row.leads,0),qualified,quoteAmount:money(quotes.map(q=>({currency:q.currency,amount:quotationAmount(q)}))),dealAmount:money(deals.map(d=>({currency:d.currency,amount:d.dealAmount}))),grossProfit:money(deals.map(d=>({currency:d.currency,amount:d.grossProfit}))),roi:null as number|null},leads:leads.map(c=>({...c,createdAt:c.createdAt.toISOString(),inquiryAt:c.inquiryAt?.toISOString()||null,leadScore:c.aiScore})),total,pageSize:50,campaigns:rows,campaignLimit:100,
  channels:channels.map(channel=>{const list=rows.filter(c=>c.channel===channel),recorded=list.filter(c=>c.spend!==null),currencies=[...new Set(recorded.map(c=>c.currency))],spend=recorded.reduce((s,c)=>s.plus(new Prisma.Decimal(c.spend!)),new Prisma.Decimal(0)),leads=recorded.reduce((s,c)=>s+(c.leads??0),0);return {channel,customerLeads:sourceCounts.find(c=>c.source===channel)?._count._all||0,connection:list.some(c=>c.synced)?'CONNECTED' as const:'NOT_CONNECTED' as const,adSpend:recorded.length?spend.toFixed(2):null,adCurrency:recorded.length&&currencies.length===1?currencies[0]:null,adCpl:recorded.length&&leads>0&&currencies.length===1?spend.div(leads).toFixed(2):null,campaigns:list.length};}),totalCustomers:sourceCounts.reduce((s,c)=>s+c._count._all,0)};
}
export type GrowthData=Awaited<ReturnType<typeof growthCenter>>;
