import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { dayKey, localDate, periodRange } from '@/lib/time';
import { biggestFunnelLoss, changeRate, cockpitSelection, customerFunnel, rate, type CockpitSelection } from '@/lib/business-cockpit';

type Query = Parameters<typeof cockpitSelection>[0];
const within = (date: Date, start: Date, end: Date) => date >= start && date < end;
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
const channelName: Record<string, string> = { FACEBOOK: 'Facebook Ads', TIKTOK: 'TikTok', INSTAGRAM: 'Instagram', WEBSITE: 'Website', WHATSAPP: 'WhatsApp' };
const channelKey = (source: string) => source.toUpperCase().includes('FACEBOOK') ? 'FACEBOOK' : source.toUpperCase().includes('TIKTOK') ? 'TIKTOK' : source.toUpperCase().includes('INSTAGRAM') ? 'INSTAGRAM' : source.toUpperCase().includes('WEBSITE') || source.toUpperCase().includes('WEB') ? 'WEBSITE' : source.toUpperCase().includes('WHATSAPP') ? 'WHATSAPP' : null;
const dated = (key: string, timezone: string) => localDate(`${key}T00:00`, timezone);
const shiftKey = (key: string, days: number) => { const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const inquiryWindow = (start: Date, end: Date): Prisma.CustomerWhereInput => ({
 OR: [{ inquiryAt: { gte: start, lt: end } }, { inquiryAt: null, createdAt: { gte: start, lt: end } }],
});

/** Dashboard reads existing records only. Currency and incomplete attribution remain visible to the user. */
export async function businessCockpit(user: Actor, query: Query, now = new Date()) {
 const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
 const timezone = settings.timezone;
 const selected = cockpitSelection(query, timezone, now);
 const today = dayKey(now, timezone), year = Number(today.slice(0, 4));
 const yearStart = dated(`${year}-01-01`, timezone), nextYear = dated(`${year + 1}-01-01`, timezone);
 const effectiveEnd = new Date(Math.min(now.getTime(), selected.end.getTime()));
 const previousEnd = selected.start;
 const previousStart = new Date(selected.start.getTime() - Math.max(0, effectiveEnd.getTime() - selected.start.getTime()));
 const dataStart = new Date(Math.min(selected.start.getTime(), previousStart.getTime(), dated(selected.trendStartKey, timezone).getTime(), selected.range === 'year' ? yearStart.getTime() : Infinity));
 const customerScope = scope(user);
 const target = user.role === 'ADMIN' ? await db.salesTarget.findUnique({ where: { periodKey: `YEAR-${year}` } }) : null;
 const currency = target?.currency || settings.currency;
 const weekKey = selected.range === 'week' ? periodRange('WEEK', today, timezone).key : '';
 const campaignScope = user.role === 'ADMIN' ? {} : { createdBy: user.id };
 const taskScope = user.role === 'ADMIN' ? {} : { createdBy: user.id };
 const quoteCutoff = new Date(now.getTime() - 3 * 86400000);
 const [deals, orders, quotes, customers, previousCustomers, metrics, periodTargets, overdueTasks, dueTasks, doneTasks, lateQuotes] = await Promise.all([
  db.deal.findMany({ where: { customer: customerScope, dealDate: { gte: dataStart, lt: effectiveEnd } }, select: { dealDate: true, currency: true, dealAmount: true, grossProfit: true, customer: { select: { source: true } } } }),
  db.order.findMany({ where: { customer: customerScope, orderDate: { gte: dataStart, lt: effectiveEnd }, status: { not: 'CANCELLED' } }, select: { orderDate: true } }),
  db.quotation.findMany({ where: { customer: customerScope, status: 'SENT', sentAt: { gte: dataStart, lt: effectiveEnd } }, select: { sentAt: true, currency: true, unitPrice: true, quantity: true } }),
  db.customer.findMany({ where: { ...customerScope, ...inquiryWindow(selected.start, effectiveEnd) }, select: { stage: true, isQualified: true, quotedAt: true, source: true, quotations: { where: { status: 'SENT' }, select: { id: true }, take: 1 }, deals: { select: { id: true }, take: 1 } } }),
  db.customer.count({ where: { ...customerScope, ...inquiryWindow(previousStart, previousEnd) } }),
  db.marketingMetric.findMany({ where: { metricDate: { gte: selected.start, lt: effectiveEnd }, campaign: campaignScope }, select: { spend: true, campaign: { select: { channel: true, currency: true } } } }),
  target ? db.salesTarget.findMany({ where: { currency, OR: [{ year }, ...(weekKey ? [{ periodKey: weekKey }] : [])] }, select: { periodKey: true, periodType: true, month: true, targetRevenue: true } }) : Promise.resolve([]),
  db.task.count({ where: { ...taskScope, deletedAt: null, status: { not: 'DONE' }, dueDate: { lt: now } } }),
  db.task.count({ where: { ...taskScope, deletedAt: null, dueDate: { gte: selected.start, lt: effectiveEnd } } }),
  db.task.count({ where: { ...taskScope, deletedAt: null, status: 'DONE', dueDate: { gte: selected.start, lt: effectiveEnd } } }),
  db.quotation.groupBy({ by: ['customerId'], where: { status: 'SENT', sentAt: { lt: quoteCutoff }, customer: { ...customerScope, stage: { notIn: ['WON', 'LOST', 'INVALID', 'PAUSED'] }, OR: [{ lastContactAt: null }, { lastContactAt: { lt: quoteCutoff } }] } } }),
 ]);
 const currencyDeals = deals.filter(deal => deal.currency === currency);
 const periodDeals = currencyDeals.filter(deal => within(deal.dealDate, selected.start, effectiveEnd));
 const periodRevenue = sum(periodDeals.map(deal => deal.dealAmount)).toNumber();
 const previousRevenue = sum(currencyDeals.filter(deal => within(deal.dealDate, previousStart, previousEnd)).map(deal => deal.dealAmount)).toNumber();
 const currencyQuotes = quotes.filter(quote => quote.currency === currency && quote.sentAt !== null);
 const quotedAmount = sum(currencyQuotes.filter(quote => quote.sentAt && within(quote.sentAt, selected.start, effectiveEnd)).map(quote => quote.unitPrice.mul(quote.quantity))).toNumber();
 const previousQuotedAmount = sum(currencyQuotes.filter(quote => quote.sentAt && within(quote.sentAt, previousStart, previousEnd)).map(quote => quote.unitPrice.mul(quote.quantity))).toNumber();
 const grossProfit = user.role === 'ADMIN' ? sum(periodDeals.map(deal => deal.grossProfit)).toNumber() : null;
 const periodOrders = orders.filter(order => within(order.orderDate, selected.start, effectiveEnd)).length;
 const previousProfit = sum(currencyDeals.filter(deal => within(deal.dealDate, previousStart, previousEnd)).map(deal => deal.grossProfit)).toNumber();
 const previousOrders = orders.filter(order => within(order.orderDate, previousStart, previousEnd)).length;
 const monthlyTargets = periodTargets.filter(row => row.periodType === 'MONTH' && row.month !== null);
 const currentMonth = Number(today.slice(5, 7));
 const quarterStartMonth = Math.floor((currentMonth - 1) / 3) * 3 + 1;
 const monthTarget = (month: number) => monthlyTargets.find(row => row.month === month)?.targetRevenue ?? null;
 const quarterTargets = [quarterStartMonth, quarterStartMonth + 1, quarterStartMonth + 2].map(monthTarget);
 const periodGoal = selected.range === 'year' ? target?.targetRevenue.toNumber() ?? null
  : selected.range === 'quarter' ? quarterTargets.every(value => value !== null) ? sum(quarterTargets as Prisma.Decimal[]).toNumber() : null
  : selected.range === 'month' ? monthTarget(currentMonth)?.toNumber() ?? null
  : selected.range === 'week' ? periodTargets.find(row => row.periodKey === weekKey)?.targetRevenue.toNumber() ?? null : null;
 const completion = periodGoal && periodGoal > 0 ? rate(periodRevenue, periodGoal) : null;
 const breakdown = selected.range === 'year' ? Array.from({ length: 4 }, (_, index) => {
  const start = dated(`${year}-${String(index * 3 + 1).padStart(2, '0')}-01`, timezone);
  const end = index === 3 ? nextYear : dated(`${year}-${String(index * 3 + 4).padStart(2, '0')}-01`, timezone);
  const goals = [index * 3 + 1, index * 3 + 2, index * 3 + 3].map(monthTarget);
  const goal = goals.every(value => value !== null) ? sum(goals as Prisma.Decimal[]).toNumber() : null;
  const actual = sum(currencyDeals.filter(deal => within(deal.dealDate, start, end)).map(deal => deal.dealAmount)).toNumber();
  return { label: `Q${index + 1}`, goal, actual, completion: goal && goal > 0 ? rate(actual, goal) : null };
 }) : selected.range === 'quarter' ? [0, 1, 2].map(offset => {
  const month = quarterStartMonth + offset;
  const start = dated(`${year}-${String(month).padStart(2, '0')}-01`, timezone);
  const end = month === 12 ? nextYear : dated(`${year}-${String(month + 1).padStart(2, '0')}-01`, timezone);
  const goal = monthTarget(month)?.toNumber() ?? null;
  const actual = sum(currencyDeals.filter(deal => within(deal.dealDate, start, end)).map(deal => deal.dealAmount)).toNumber();
  return { label: `${month} 月`, goal, actual, completion: goal && goal > 0 ? rate(actual, goal) : null };
 }) : [];
 const trend = buildTrend(selected, timezone, currencyDeals, orders);
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
  ...(funnelLoss && funnelLoss.loss > 0 ? [{ kind: 'insight' as const, title: `${funnelLoss.from} → ${funnelLoss.to} 流失 ${funnelLoss.loss} 位客户`, detail: '基于所选时间内询盘客户的当前阶段，检查此环节话术与交付速度。', href: '/crm' }] : []),
  ...(channels.find(channel => channel.roi !== null && channel.roi < 0) ? [{ kind: 'insight' as const, title: '有渠道的毛利回报为负', detail: '检查广告投入与该渠道客户的成交毛利。', href: '/growth' }] : []),
 ];
 if (!suggestions.length) suggestions.push({ kind: 'insight', title: '当前没有紧急经营异常', detail: '查看销售趋势和待办执行进度，继续推进本期目标。', href: '/tasks' });
 return {
  generatedAt: now.toISOString(), timezone, selected, scope: user.role === 'ADMIN' ? '团队' : '个人', currency, year,
  kpis: { periodRevenue, quotedAmount, grossProfit, periodOrders, newCustomers: customers.length, completion },
  kpiTrends: { periodRevenue: changeRate(periodRevenue, previousRevenue), quotedAmount: changeRate(quotedAmount, previousQuotedAmount), grossProfit: grossProfit === null ? null : changeRate(grossProfit, previousProfit), periodOrders: changeRate(periodOrders, previousOrders), newCustomers: changeRate(customers.length, previousCustomers), completion: null },
  goal: { periodGoal, periodRevenue, previousRevenue, remaining: periodGoal === null ? null : Math.max(0, periodGoal - periodRevenue), completion, breakdown },
  trend, funnel, funnelLoss, execution: { dueTasks, doneTasks, completion: rate(doneTasks, dueTasks) },
  channels, suggestions, attributionNote: '渠道收入按客户来源归类；毛利回报仅在广告花费与成交币种一致时估算。未包含完整营销归因。',
  excludedCurrencies: [...new Set([...deals.filter(deal => within(deal.dealDate, selected.start, effectiveEnd) && deal.currency !== currency).map(deal => deal.currency), ...quotes.filter(quote => quote.sentAt && within(quote.sentAt, selected.start, effectiveEnd) && quote.currency !== currency).map(quote => quote.currency)])],
 };
}
export type BusinessCockpit = Awaited<ReturnType<typeof businessCockpit>>;

function buildTrend(selected: CockpitSelection, timezone: string,
 deals: { dealDate: Date; dealAmount: Prisma.Decimal }[], orders: { orderDate: Date }[]) {
 const boundaries: { start: string; end: string; label: string }[] = [];
 let cursor = selected.trendStartKey;
 while (cursor <= selected.endKey) {
  const next = selected.trend === 'day' ? shiftKey(cursor, 1) : selected.trend === 'week' ? shiftKey(cursor, 7 - ((new Date(`${cursor}T12:00:00Z`).getUTCDay() + 6) % 7)) : `${Number(cursor.slice(5, 7)) === 12 ? Number(cursor.slice(0, 4)) + 1 : cursor.slice(0, 4)}-${String(Number(cursor.slice(5, 7)) % 12 + 1).padStart(2, '0')}-01`;
  const end = shiftKey(next, -1) < selected.endKey ? shiftKey(next, -1) : selected.endKey;
  const label = selected.trend === 'month' ? `${cursor.slice(0, 4) === selected.endKey.slice(0, 4) ? '' : `${cursor.slice(0, 4)}/`}${Number(cursor.slice(5, 7))}月` : `${Number(cursor.slice(5, 7))}/${Number(cursor.slice(8, 10))}`;
  boundaries.push({ start: cursor, end, label });
  cursor = next;
 }
 const points = boundaries.map(boundary => ({ label: boundary.label, revenue: 0, orders: 0 }));
 const bucket = (date: Date) => boundaries.findIndex(boundary => { const key = dayKey(date, timezone); return key >= boundary.start && key <= boundary.end; });
 for (const deal of deals) { const index = bucket(deal.dealDate); if (index >= 0) points[index].revenue += deal.dealAmount.toNumber(); }
 for (const order of orders) { const index = bucket(order.orderDate); if (index >= 0) points[index].orders++; }
 return { view: selected.trend, label: selected.range === 'today' ? '近 7 天（含今日）' : `${selected.label} · ${selected.startKey} — ${selected.endKey}`, points };
}
