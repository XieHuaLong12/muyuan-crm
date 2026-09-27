import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { dayKey, localDate } from '@/lib/time';
import { biggestFunnelLoss, changeRate, cockpitSelection, customerFunnel, rate } from '@/lib/business-cockpit';

type Query = Parameters<typeof cockpitSelection>[0];
const within = (date: Date, start: Date, end: Date) => date >= start && date < end;
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
const channelName: Record<string, string> = { FACEBOOK: 'Facebook Ads', TIKTOK: 'TikTok', INSTAGRAM: 'Instagram', WEBSITE: 'Website', WHATSAPP: 'WhatsApp' };
const channelKey = (source: string) => source.toUpperCase().includes('FACEBOOK') ? 'FACEBOOK' : source.toUpperCase().includes('TIKTOK') ? 'TIKTOK' : source.toUpperCase().includes('INSTAGRAM') ? 'INSTAGRAM' : source.toUpperCase().includes('WEBSITE') || source.toUpperCase().includes('WEB') ? 'WEBSITE' : source.toUpperCase().includes('WHATSAPP') ? 'WHATSAPP' : null;
const dated = (key: string, timezone: string) => localDate(`${key}T00:00`, timezone);
const dateKey = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

/** Dashboard reads existing records only. Currency and incomplete attribution remain visible to the user. */
export async function businessCockpit(user: Actor, query: Query, now = new Date()) {
 const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
 const timezone = settings.timezone;
 const selected = cockpitSelection(query, timezone, now);
 const today = dayKey(now, timezone), year = Number(today.slice(0, 4));
 const monthNumber = Number(today.slice(5, 7)), dayNumber = Number(today.slice(8, 10));
 const yearStart = dated(`${year}-01-01`, timezone), nextYear = dated(`${year + 1}-01-01`, timezone);
 const monthStart = dated(`${today.slice(0, 7)}-01`, timezone);
 const previousYearStart = dated(`${year - 1}-01-01`, timezone);
 const previousYearEnd = dated(dateKey(year - 1, monthNumber, Math.min(dayNumber, new Date(Date.UTC(year - 1, monthNumber, 0)).getUTCDate()) + 1), timezone);
 const previousMonthKey = dateKey(year, monthNumber - 1, 1);
 const previousMonthStart = dated(previousMonthKey, timezone);
 const previousMonthEnd = dated(dateKey(Number(previousMonthKey.slice(0, 4)), Number(previousMonthKey.slice(5, 7)), Math.min(dayNumber, new Date(Date.UTC(year, monthNumber - 1, 0)).getUTCDate()) + 1), timezone);
 const effectiveEnd = new Date(Math.min(now.getTime(), selected.end.getTime()));
 const previousEnd = selected.start;
 const previousStart = new Date(selected.start.getTime() - Math.max(0, effectiveEnd.getTime() - selected.start.getTime()));
 const dataStart = new Date(Math.min(previousYearStart.getTime(), previousStart.getTime()));
 const dataEnd = new Date(now.getTime() + 86400000);
 const customerScope = scope(user);
 const target = user.role === 'ADMIN' ? await db.salesTarget.findUnique({ where: { periodKey: `YEAR-${year}` } }) : null;
 const currency = target?.currency || settings.currency;
 const campaignScope = user.role === 'ADMIN' ? {} : { createdBy: user.id };
 const taskScope = user.role === 'ADMIN' ? {} : { createdBy: user.id };
 const quoteCutoff = new Date(now.getTime() - 3 * 86400000);
 const [deals, orders, customers, previousCustomers, metrics, monthlyTargets, overdueTasks, dueTasks, doneTasks, lateQuotes] = await Promise.all([
  db.deal.findMany({ where: { customer: customerScope, dealDate: { gte: dataStart, lt: dataEnd } }, select: { dealDate: true, currency: true, dealAmount: true, grossProfit: true, customer: { select: { source: true } } } }),
  db.order.findMany({ where: { customer: customerScope, orderDate: { gte: dataStart, lt: dataEnd }, status: { not: 'CANCELLED' } }, select: { orderDate: true } }),
  db.customer.findMany({ where: { ...customerScope, createdAt: { gte: selected.start, lt: selected.end } }, select: { stage: true, isQualified: true, quotedAt: true, source: true, quotations: { where: { status: 'SENT' }, select: { id: true }, take: 1 }, deals: { select: { id: true }, take: 1 } } }),
  db.customer.count({ where: { ...customerScope, createdAt: { gte: previousStart, lt: previousEnd } } }),
  db.marketingMetric.findMany({ where: { metricDate: { gte: selected.start, lt: effectiveEnd }, campaign: campaignScope }, select: { spend: true, campaign: { select: { channel: true, currency: true } } } }),
  target ? db.salesTarget.findMany({ where: { periodType: 'MONTH', year, currency: target.currency }, select: { month: true, targetRevenue: true } }) : Promise.resolve([]),
  db.task.count({ where: { ...taskScope, deletedAt: null, status: { not: 'DONE' }, dueDate: { lt: now } } }),
  db.task.count({ where: { ...taskScope, deletedAt: null, dueDate: { gte: selected.start, lt: selected.end } } }),
  db.task.count({ where: { ...taskScope, deletedAt: null, status: 'DONE', dueDate: { gte: selected.start, lt: selected.end } } }),
  db.quotation.groupBy({ by: ['customerId'], where: { status: 'SENT', sentAt: { lt: quoteCutoff }, customer: { ...customerScope, stage: { notIn: ['WON', 'LOST', 'INVALID', 'PAUSED'] }, OR: [{ lastContactAt: null }, { lastContactAt: { lt: quoteCutoff } }] } } }),
 ]);
 const currencyDeals = deals.filter(deal => deal.currency === currency);
 const yearDeals = currencyDeals.filter(deal => within(deal.dealDate, yearStart, nextYear) && deal.dealDate <= now);
 const monthDeals = currencyDeals.filter(deal => deal.dealDate >= monthStart && deal.dealDate <= now);
 const periodDeals = currencyDeals.filter(deal => within(deal.dealDate, selected.start, effectiveEnd));
 const annualRevenue = sum(yearDeals.map(deal => deal.dealAmount)).toNumber();
 const monthlyRevenue = sum(monthDeals.map(deal => deal.dealAmount)).toNumber();
 const grossProfit = user.role === 'ADMIN' ? sum(periodDeals.map(deal => deal.grossProfit)).toNumber() : null;
 const periodOrders = orders.filter(order => within(order.orderDate, selected.start, effectiveEnd)).length;
 const previousYearRevenue = sum(currencyDeals.filter(deal => within(deal.dealDate, previousYearStart, previousYearEnd)).map(deal => deal.dealAmount)).toNumber();
 const previousMonthRevenue = sum(currencyDeals.filter(deal => within(deal.dealDate, previousMonthStart, previousMonthEnd)).map(deal => deal.dealAmount)).toNumber();
 const previousProfit = sum(currencyDeals.filter(deal => within(deal.dealDate, previousStart, previousEnd)).map(deal => deal.grossProfit)).toNumber();
 const previousOrders = orders.filter(order => within(order.orderDate, previousStart, previousEnd)).length;
 const annualGoal = target?.targetRevenue.toNumber() ?? null;
 const completion = annualGoal && annualGoal > 0 ? rate(annualRevenue, annualGoal) : null;
 const quarters = Array.from({ length: 4 }, (_, index) => {
  const start = dated(`${year}-${String(index * 3 + 1).padStart(2, '0')}-01`, timezone);
  const end = index === 3 ? nextYear : dated(`${year}-${String(index * 3 + 4).padStart(2, '0')}-01`, timezone);
  const goalRows = monthlyTargets.filter(row => row.month !== null && row.month >= index * 3 + 1 && row.month <= index * 3 + 3);
  const goal = goalRows.length === 3 ? sum(goalRows.map(row => row.targetRevenue)).toNumber() : null;
  const actual = sum(yearDeals.filter(deal => within(deal.dealDate, start, end)).map(deal => deal.dealAmount)).toNumber();
  return { label: `Q${index + 1}`, goal, actual, completion: goal && goal > 0 ? rate(actual, goal) : null };
 });
 const trend = buildTrend(selected.trend, today, timezone, currencyDeals, orders);
 const funnel = customerFunnel(customers);
 const funnelLoss = biggestFunnelLoss(funnel);
 const channels = Object.entries(channelName).map(([id, name]) => {
  const channelCustomers = customers.filter(customer => channelKey(customer.source) === id).length;
  const matchedDeals = periodDeals.filter(deal => channelKey(deal.customer.source) === id);
  const revenue = sum(matchedDeals.map(deal => deal.dealAmount)).toNumber();
  const profit = sum(matchedDeals.map(deal => deal.grossProfit)).toNumber();
  const spendRows = metrics.filter(row => channelKey(row.campaign.channel) === id);
  const spendByCurrency = Object.entries(spendRows.reduce<Record<string, Prisma.Decimal>>((acc, row) => {
   const unit = row.campaign.currency; acc[unit] = (acc[unit] || new Prisma.Decimal(0)).plus(row.spend); return acc;
  }, {})).map(([unit, value]) => ({ currency: unit, amount: value.toNumber() }));
  const matchingSpend = spendByCurrency.length === 1 && spendByCurrency[0].currency === currency ? spendByCurrency[0].amount : null;
  const roi = user.role === 'ADMIN' && matchingSpend && matchingSpend > 0 ? Math.round((profit - matchingSpend) / matchingSpend * 100) : null;
  return { id, name, customers: channelCustomers, revenue, spend: spendByCurrency, roi };
 });
 const staleQuotes = lateQuotes.length;
 const suggestions = [
  ...(overdueTasks ? [{ kind: 'warning' as const, title: `${overdueTasks} 项任务已经逾期`, detail: '优先处理已超过承诺时间的客户动作。', href: '/tasks?view=OVERDUE' }] : []),
  ...(staleQuotes ? [{ kind: 'warning' as const, title: `${staleQuotes} 位报价客户超过 3 天未推进`, detail: '查看报价后的跟进记录，安排下一次联系。', href: '/sales?queue=today' }] : []),
  ...(funnelLoss && funnelLoss.loss > 0 ? [{ kind: 'insight' as const, title: `${funnelLoss.from} → ${funnelLoss.to} 流失 ${funnelLoss.loss} 位客户`, detail: '基于所选时间内新增客户的当前阶段，检查此环节话术与交付速度。', href: '/crm' }] : []),
  ...(channels.find(channel => channel.roi !== null && channel.roi < 0) ? [{ kind: 'insight' as const, title: '有渠道的毛利回报为负', detail: '检查广告投入与该渠道客户的成交毛利。', href: '/growth' }] : []),
 ];
 if (!suggestions.length) suggestions.push({ kind: 'insight', title: '当前没有紧急经营异常', detail: '查看销售趋势和待办执行进度，继续推进本期目标。', href: '/tasks' });
 return {
  generatedAt: now.toISOString(), timezone, selected, scope: user.role === 'ADMIN' ? '团队' : '个人', currency, year,
  kpis: { annualRevenue, monthlyRevenue, grossProfit, periodOrders, newCustomers: customers.length, completion },
  kpiTrends: { annualRevenue: changeRate(annualRevenue, previousYearRevenue), monthlyRevenue: changeRate(monthlyRevenue, previousMonthRevenue), grossProfit: grossProfit === null ? null : changeRate(grossProfit, previousProfit), periodOrders: changeRate(periodOrders, previousOrders), newCustomers: changeRate(customers.length, previousCustomers), completion: null },
  goal: { annualGoal, annualRevenue, remaining: annualGoal === null ? null : Math.max(0, annualGoal - annualRevenue), completion, quarters },
  trend, funnel, funnelLoss, execution: { dueTasks, doneTasks, completion: rate(doneTasks, dueTasks) },
  channels, suggestions, attributionNote: '渠道收入按客户来源归类；毛利回报仅在广告花费与成交币种一致时估算。未包含完整营销归因。',
  excludedDealCurrencies: [...new Set(deals.filter(deal => within(deal.dealDate, selected.start, selected.end) && deal.currency !== currency).map(deal => deal.currency))],
 };
}
export type BusinessCockpit = Awaited<ReturnType<typeof businessCockpit>>;

function buildTrend(view: 'month' | 'quarter' | 'year', today: string, timezone: string,
 deals: { dealDate: Date; dealAmount: Prisma.Decimal }[], orders: { orderDate: Date }[]) {
 const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
 const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
 const startKey = view === 'month' ? `${today.slice(0, 7)}-01` : view === 'quarter' ? `${year}-${String(quarterMonth).padStart(2, '0')}-01` : `${year}-01-01`;
 const start = dated(startKey, timezone), end = dated(new Date(`${today}T12:00:00Z`).toISOString().slice(0, 10), timezone);
 const length = view === 'month' ? Number(today.slice(8, 10)) : view === 'quarter' ? Math.ceil((end.getTime() - start.getTime()) / 604800000) + 1 : month;
 const points = Array.from({ length }, (_, index) => ({ label: view === 'month' ? `${index + 1}日` : view === 'quarter' ? `W${index + 1}` : `${index + 1}月`, revenue: 0, orders: 0 }));
 const bucket = (date: Date) => {
  const value = dayKey(date, timezone);
  if (value < startKey || value > today) return -1;
  if (view === 'month') return Number(value.slice(8, 10)) - 1;
  if (view === 'year') return Number(value.slice(5, 7)) - 1;
  return Math.floor((dated(value, timezone).getTime() - start.getTime()) / 604800000);
 };
 for (const deal of deals) { const index = bucket(deal.dealDate); if (points[index]) points[index].revenue += deal.dealAmount.toNumber(); }
 for (const order of orders) { const index = bucket(order.orderDate); if (points[index]) points[index].orders++; }
 return { view, points };
}
