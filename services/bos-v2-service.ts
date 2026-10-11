import { taskScope } from './task-service';
import { quotationAmount } from '@/lib/quotation-amount';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor,HttpError,scope } from '@/lib/auth';
import { bosDateRange } from '@/lib/bos';
import { cockpitSelection } from '@/lib/business-cockpit';
import { dealsIn, moneyByCurrency, ordersIn } from '@/lib/metrics';
import { dayKey } from '@/lib/time';

const addDays=(date:Date,days:number)=>new Date(date.getTime()+days*86400000);
const percentage=(current:number,previous:number)=>previous>0?Math.round((current-previous)/previous*100):null;
// One way to add up money in this codebase: per currency, never converted (lib/metrics).
const sumMoney=moneyByCurrency;

/** Read-only dashboard data. Every figure retains its source and currency. */
export async function bosOverview(user:Actor,now=new Date()){
 const settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
 const {today,start,end,monthStart}=bosDateRange(now,settings.timezone);
 const previousStart=addDays(start,-1),windowStart=addDays(start,-29),previousWindowStart=addDays(windowStart,-30);
 const customer=scope(user),campaign=user.role==='ADMIN'?{}:{createdBy:user.id};
 const [newToday,newYesterday,followUps,quotes,deals,monthOrders,metrics,previousMetrics,leads,qualified,quoted,won,previousLeads,previousQualified,previousQuoted,previousWon,lateQuote,overdueTasks]=await Promise.all([
  db.customer.count({where:{...customer,createdAt:{gte:start,lt:end}}}),
  db.customer.count({where:{...customer,createdAt:{gte:previousStart,lt:start}}}),
  db.customer.count({where:{...customer,stage:{notIn:['WON','LOST','INVALID','PAUSED']},nextFollowUpAt:{lt:end}}}),
  db.quotation.findMany({where:{customer,sentAt:{gte:start,lt:end}},select:{currency:true,unitPrice:true,quantity:true,totalAmount:true}}),
  db.deal.findMany({where:{customer,dealDate:{gte:monthStart,lt:end}},select:{currency:true,dealAmount:true,grossProfit:true}}),
  db.order.count({where:{customer,orderDate:{gte:monthStart,lt:end},status:{not:'CANCELLED'}}}),
  db.marketingMetric.findMany({where:{metricDate:{gte:monthStart,lt:end},campaign},select:{metricDate:true,spend:true,impressions:true,clicks:true,leads:true,campaign:{select:{currency:true,channel:true}}}}),
  db.marketingMetric.findMany({where:{metricDate:{gte:previousWindowStart,lt:windowStart},campaign},select:{impressions:true,clicks:true,leads:true}}),
  db.customer.count({where:{...customer,createdAt:{gte:windowStart,lt:end}}}),
  db.customer.count({where:{...customer,createdAt:{gte:windowStart,lt:end},isQualified:true}}),
  db.quotation.count({where:{customer,sentAt:{gte:windowStart,lt:end}}}),
  db.deal.count({where:{customer,dealDate:{gte:windowStart,lt:end}}}),
  db.customer.count({where:{...customer,createdAt:{gte:previousWindowStart,lt:windowStart}}}),
  db.customer.count({where:{...customer,createdAt:{gte:previousWindowStart,lt:windowStart},isQualified:true}}),
  db.quotation.count({where:{customer,sentAt:{gte:previousWindowStart,lt:windowStart}}}),
  db.deal.count({where:{customer,dealDate:{gte:previousWindowStart,lt:windowStart}}}),
  db.quotation.findFirst({where:{status:'SENT',sentAt:{lt:addDays(start,-3)},customer:{...customer,stage:{notIn:['WON','LOST','INVALID','PAUSED']}}},select:{customer:{select:{id:true,name:true}}},orderBy:{sentAt:'asc'}}),
  db.task.count({where:{...taskScope(user),status:{not:'DONE'},dueDate:{lt:start}}}),
 ]);
 const todayMetrics=metrics.filter(m=>m.metricDate.toISOString().slice(0,10)===today);
 const adSpendToday=sumMoney(todayMetrics.map(m=>({currency:m.campaign.currency,amount:m.spend})));
 const adSpendMonth=sumMoney(metrics.map(m=>({currency:m.campaign.currency,amount:m.spend})));
 const quoteAmount=sumMoney(quotes.map(q=>({currency:q.currency,amount:quotationAmount(q)})));
 const dealAmount=sumMoney(deals.map(d=>({currency:d.currency,amount:d.dealAmount})));
 const grossProfit=sumMoney(deals.map(d=>({currency:d.currency,amount:d.grossProfit})));
 const last30=metrics.filter(m=>m.metricDate>=windowStart);
 const funnel=[
  {label:'广告曝光',count:last30.reduce((n,m)=>n+m.impressions,0),previous:previousMetrics.reduce((n,m)=>n+m.impressions,0),source:'已同步广告数据'},
  {label:'点击',count:last30.reduce((n,m)=>n+m.clicks,0),previous:previousMetrics.reduce((n,m)=>n+m.clicks,0),source:'已同步广告数据'},
  {label:'询盘',count:leads,previous:previousLeads,source:'CRM 新增客户'},
  {label:'有效客户',count:qualified,previous:previousQualified,source:'CRM 资格标记'},
  {label:'报价',count:quoted,previous:previousQuoted,source:'已发送报价单'},
  {label:'成交',count:won,previous:previousWon,source:'成交记录'},
 ].map((step,index,array)=>({...step,rate:index===0?null:array[index-1].count>0?Math.round(step.count/array[index-1].count*1000)/10:null,trend:percentage(step.count,step.previous)}));
 const previousClicks=previousMetrics.reduce((n,m)=>n+m.clicks,0);
 const currentClicks=last30.reduce((n,m)=>n+m.clicks,0);
 const suggestions=[
  ...(overdueTasks?[{title:`${overdueTasks} 项任务已逾期`,detail:'先处理承诺过时间的客户动作。',href:'/tasks?view=OVERDUE',kind:'urgent'}]:[]),
  ...(lateQuote?[{title:`${lateQuote.customer.name} 的报价需要回访`,detail:'报价发出超过 3 天，客户尚未进入成交阶段。',href:`/customers/${lateQuote.customer.id}`,kind:'followup'}]:[]),
  ...(followUps?[{title:`今天有 ${followUps} 位客户待跟进`,detail:'打开销售工作台，按优先级逐一处理。',href:'/sales?queue=today',kind:'action'}]:[]),
  ...(previousClicks>0&&currentClicks<previousClicks*.8?[{title:'广告点击量较上一周期下降',detail:'先检查广告活动状态与素材表现。',href:'/growth',kind:'growth'}]:[]),
 ];
 if(!suggestions.length)suggestions.push({title:'今日经营节奏平稳',detail:'暂无逾期任务；可以检查新线索和广告投入。',href:'/growth',kind:'action'});
 return {generatedAt:now.toISOString(),timezone:settings.timezone,scope:user.role==='ADMIN'?'团队':'个人',newToday,newChange:percentage(newToday,newYesterday),adSpendToday,adSpendMonth,quoteAmount,dealAmount,grossProfit,monthOrders,followUps,funnel,suggestions,hasAdData:metrics.length>0};
}
export type BosOverview=Awaited<ReturnType<typeof bosOverview>>;

/** Finance is intentionally admin-only; net profit is unavailable without complete expense data. */
export async function financeOverview(user:Actor,query:Parameters<typeof cockpitSelection>[0]={},now=new Date()){
 if(user.role!=='ADMIN')throw new HttpError(403,'需要管理员权限');
 const settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
 // Same periods and the same revenue and order rules as the cockpit (lib/metrics), so both pages agree.
 const selected=cockpitSelection(query,settings.timezone,now);
 const period={start:selected.start,end:new Date(Math.min(now.getTime(),selected.end.getTime()))},live={deletedAt:null};
 const [totals,deals,metrics,orders]=await Promise.all([
  db.deal.groupBy({by:['currency'],where:dealsIn(period,live),_sum:{dealAmount:true,productCost:true,grossProfit:true}}),
  db.deal.findMany({where:dealsIn(period,live),select:{currency:true,dealAmount:true,productCost:true,grossProfit:true,customer:{select:{id:true,name:true}},orderNumber:true,dealDate:true},orderBy:{dealDate:'desc'},take:12}),
  db.marketingMetric.findMany({where:{metricDate:{gte:period.start,lt:period.end}},select:{spend:true,campaign:{select:{currency:true,channel:true}}}}),
  db.order.count({where:ordersIn(period,live)}),
 ]);
 const today=dayKey(now,settings.timezone);
 return {selected:{range:selected.range,startKey:selected.startKey,endKey:selected.endKey,label:selected.label},today,timezone:settings.timezone,orders,revenue:sumMoney(totals.map(d=>({currency:d.currency,amount:d._sum.dealAmount??new Prisma.Decimal(0)}))),productCost:sumMoney(totals.map(d=>({currency:d.currency,amount:d._sum.productCost??new Prisma.Decimal(0)}))),grossProfit:sumMoney(totals.map(d=>({currency:d.currency,amount:d._sum.grossProfit??new Prisma.Decimal(0)}))),adSpend:sumMoney(metrics.map(m=>({currency:m.campaign.currency,amount:m.spend}))),deals:deals.map(d=>({customerId:d.customer.id,customerName:d.customer.name,orderNumber:d.orderNumber,date:d.dealDate.toISOString(),currency:d.currency,revenue:d.dealAmount.toFixed(2),cost:d.productCost.toFixed(2),profit:d.grossProfit.toFixed(2),margin:d.dealAmount.gt(0)?d.grossProfit.div(d.dealAmount).mul(100).toFixed(1):null}))};
}
export type FinanceOverview=Awaited<ReturnType<typeof financeOverview>>;
