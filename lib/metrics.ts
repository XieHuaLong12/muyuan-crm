import { Prisma } from '@prisma/client';
import { ADVANCED_STAGES, TERMINAL_STAGES } from '@/lib/constants';

/**
 * One definition for every business number shown on more than one page. The cockpit, team performance, source and
 * country analysis, finance and ad analytics all build their queries here, so the same period shows the same number
 * everywhere. The wording shown to users lives in METRIC_NOTES; docs/METRICS.md explains each rule.
 */
export type Period = { start: Date; end: Date };
type CustomerScope = Prisma.CustomerWhereInput;
const within = ({ start, end }: Period) => ({ gte: start, lt: end });

/** New inquiries: inquiry date in the period (creation date when there is none), including unassigned customers. */
export function inquiryIn(period: Period): Prisma.CustomerWhereInput {
  return { OR: [{ inquiryAt: within(period) }, { inquiryAt: null, createdAt: within(period) }] };
}

/** Qualified: not marked invalid, and either marked qualified by sales or already quoted or further. */
export const QUALIFIED: Prisma.CustomerWhereInput = { stage: { not: 'INVALID' }, OR: [{ isQualified: true }, { stage: { in: [...ADVANCED_STAGES] } }] };
export function isQualified(customer: { stage: string; isQualified: boolean | null }) {
  return customer.stage !== 'INVALID' && (customer.isQualified === true || (ADVANCED_STAGES as readonly string[]).includes(customer.stage));
}

/** Deals: deal date in the period, customer not in the recycle bin. Amounts are summed per currency. */
export function dealsIn(period: Period, customer: CustomerScope): Prisma.DealWhereInput {
  return { customer, dealDate: within(period) };
}
/** Orders: order date in the period, not cancelled. */
export function ordersIn(period: Period, customer: CustomerScope): Prisma.OrderWhereInput {
  return { customer, orderDate: within(period), status: { not: 'CANCELLED' } };
}
/** Quotations sent to the customer, by sending date. Drafts are not quotes. */
export function sentQuotesIn(period: Period, customer: CustomerScope): Prisma.QuotationWhereInput {
  return { customer, status: 'SENT', sentAt: within(period) };
}

export const STALE_QUOTE_DAYS = 3;
/** Quotes waiting too long: sent more than three days ago, customer still open, nobody has contacted them since. */
export function staleQuotes(now: Date, customer: CustomerScope): Prisma.QuotationWhereInput {
  const cutoff = new Date(now.getTime() - STALE_QUOTE_DAYS * 86400_000);
  return { status: 'SENT', sentAt: { lt: cutoff }, customer: { ...customer, stage: { notIn: [...TERMINAL_STAGES] }, OR: [{ lastContactAt: null }, { lastContactAt: { lt: cutoff } }] } };
}

/** Overdue tasks: not done and past due. `scope` is the task page's own scope (taskScope), so both pages agree. */
export function overdueTasks(now: Date, scope: Prisma.TaskWhereInput): Prisma.TaskWhereInput {
  return { AND: [scope, { status: { not: 'DONE' }, dueDate: { lt: now } }] };
}

export type Money = { currency: string; amount: string };
/** Sums amounts per currency (never converts between currencies), largest first. */
export function moneyByCurrency(rows: { currency: string; amount: Prisma.Decimal | null }[]): Money[] {
  const totals = new Map<string, Prisma.Decimal>();
  for (const row of rows) if (row.amount) totals.set(row.currency, (totals.get(row.currency) ?? new Prisma.Decimal(0)).plus(row.amount));
  return [...totals].sort((a, b) => b[1].comparedTo(a[1])).map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }));
}

export { METRIC_NOTES } from './metric-notes';
