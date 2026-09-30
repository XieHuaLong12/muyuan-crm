import { dayKey, localDate } from './time';

export type CockpitRange = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
export type TrendView = 'day' | 'week' | 'month';
export type CockpitSelection = { range: CockpitRange; start: Date; end: Date; startKey: string; endKey: string; label: string; trend: TrendView; trendStartKey: string };
const validKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const key = (date: Date) => date.toISOString().slice(0, 10);
const shift = (value: string, days: number) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return key(date); };

export function cockpitSelection(query: { range?: string; startDate?: string; endDate?: string; trend?: string }, timezone: string, now = new Date()): CockpitSelection {
 const today = dayKey(now, timezone), date = new Date(`${today}T12:00:00Z`);
 const year = date.getUTCFullYear(), month = date.getUTCMonth();
 const requested = query.range;
 let range: CockpitRange = requested === 'today' || requested === 'week' || requested === 'month' || requested === 'quarter' || requested === 'year' || requested === 'custom' ? requested : 'month';
 if (range === 'custom' && (!validKey(query.startDate || '') || !validKey(query.endDate || '') || query.startDate! > query.endDate! || query.endDate! > today)) range = 'month';
 let startKey = today, endKey = today;
 if (range === 'week') startKey = shift(today, -((date.getUTCDay() + 6) % 7));
 if (range === 'month') startKey = key(new Date(Date.UTC(year, month, 1)));
 if (range === 'quarter') startKey = key(new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1)));
 if (range === 'year') startKey = `${year}-01-01`;
 if (range === 'custom') {
  startKey = query.startDate!; endKey = query.endDate!;
 }
 const label = range === 'custom' ? `${startKey} — ${endKey}` : ({ today: '今天', week: '本周', month: '本月', quarter: '本季度', year: '本年度' } as const)[range];
 // The chart follows the selected business period. Old bookmarked `trend=year` URLs
 // cannot silently turn a daily/monthly page back into an annual chart.
 const days = Math.round((Date.parse(`${endKey}T12:00:00Z`) - Date.parse(`${startKey}T12:00:00Z`)) / 86400000) + 1;
 const trend: TrendView = range === 'year' || (range === 'custom' && days > 92) ? 'month' : range === 'quarter' || (range === 'custom' && days > 31) ? 'week' : 'day';
 const trendStartKey = range === 'today' ? shift(today, -6) : startKey;
 return { range, start: localDate(`${startKey}T00:00`, timezone), end: localDate(`${shift(endKey, 1)}T00:00`, timezone), startKey, endKey, label, trend, trendStartKey };
}

export function rate(part: number, total: number): number | null { return total > 0 ? Math.round(part / total * 1000) / 10 : null; }
export function changeRate(current: number, previous: number): number | null { return previous > 0 ? Math.round((current - previous) / previous * 100) : null; }

export type FunnelCustomer = { stage: string; isQualified: boolean | null; quotedAt: Date | null; quotations: { id: string }[]; deals: { id: string }[] };
export function customerFunnel(customers: FunnelCustomer[]) {
 const progressed = new Set(['QUOTED', 'FOLLOW_UP', 'ORDER', 'WON']);
 const quotedStages = new Set(['QUOTED', 'FOLLOW_UP', 'ORDER', 'WON']);
 const negotiationStages = new Set(['FOLLOW_UP', 'ORDER', 'WON']);
 let qualified = 0, quoted = 0, negotiation = 0, won = 0;
 for (const customer of customers) {
  const isQualified = customer.isQualified === true || progressed.has(customer.stage);
  const isQuoted = isQualified && (customer.quotedAt !== null || customer.quotations.length > 0 || quotedStages.has(customer.stage));
  const isNegotiating = isQuoted && (negotiationStages.has(customer.stage) || customer.deals.length > 0);
  if (isQualified) qualified++;
  if (isQuoted) quoted++;
  if (isNegotiating) negotiation++;
  if (isNegotiating && customer.deals.length > 0) won++;
 }
 const stages = [
  { label: '线索 Lead', count: customers.length }, { label: '有效客户', count: qualified },
  { label: '已报价', count: quoted }, { label: '谈判中', count: negotiation }, { label: '成交', count: won },
 ];
 return stages.map((stage, index) => ({ ...stage, conversion: index === 0 ? null : rate(stage.count, stages[0].count) }));
}

export function biggestFunnelLoss(stages: ReturnType<typeof customerFunnel>) {
 let index = -1, loss = 0;
 for (let i = 1; i < stages.length; i++) { const current = stages[i - 1].count - stages[i].count; if (current > loss) { loss = current; index = i; } }
 return index < 0 ? null : { from: stages[index - 1].label, to: stages[index].label, loss };
}
