import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor,requireAdmin } from '@/lib/auth';
import { cockpitSelection } from '@/lib/business-cockpit';
import { dealsIn, moneyByCurrency, ordersIn } from '@/lib/metrics';
import { dayKey } from '@/lib/time';

// One way to add up money in this codebase: per currency, never converted (lib/metrics).
const sumMoney=moneyByCurrency;

/** Finance is intentionally admin-only; net profit is unavailable without complete expense data. */
export async function financeOverview(user:Actor,query:Parameters<typeof cockpitSelection>[0]={},now=new Date()){
 requireAdmin(user);
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
 return {selected:{range:selected.range,startKey:selected.startKey,endKey:selected.endKey,label:selected.label},today,timezone:settings.timezone,orders,revenue:sumMoney(totals.map(d=>({currency:d.currency,amount:d._sum.dealAmount??new Prisma.Decimal(0)}))),productCost:sumMoney(totals.map(d=>({currency:d.currency,amount:d._sum.productCost??new Prisma.Decimal(0)}))),grossProfit:sumMoney(totals.map(d=>({currency:d.currency,amount:d._sum.grossProfit??new Prisma.Decimal(0)}))),adSpend:sumMoney(metrics.map(m=>({currency:m.campaign.currency,amount:m.spend}))),deals:deals.map(d=>({customerId:d.customer.id,customerName:d.customer.name,orderNumber:d.orderNumber,date:dayKey(d.dealDate,settings.timezone),currency:d.currency,revenue:d.dealAmount.toFixed(2),cost:d.productCost.toFixed(2),profit:d.grossProfit.toFixed(2),margin:d.dealAmount.gt(0)?d.grossProfit.div(d.dealAmount).mul(100).toFixed(1):null}))};
}
export type FinanceOverview=Awaited<ReturnType<typeof financeOverview>>;
