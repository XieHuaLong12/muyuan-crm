import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { cockpitSelection, rate } from '@/lib/business-cockpit';
import { sources } from '@/lib/constants';
import { dealsIn, inquiryIn, isQualified, moneyByCurrency } from '@/lib/metrics';
import { Prisma } from '@prisma/client';

type Row = { key: string; label: string; inquiries: number; qualified: number; won: Set<string>; deals: { currency: string; amount: Prisma.Decimal }[] };

/**
 * Where customers come from: new inquiries and qualified customers by inquiry date, won customers and revenue by
 * deal date — the same rules as the cockpit (lib/metrics), broken down by source and by country.
 */
export async function sourcesAndCountries(user: Actor, query: Parameters<typeof cockpitSelection>[0] = {}, now = new Date()) {
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const selected = cockpitSelection(query, settings.timezone, now);
  const period = { start: selected.start, end: new Date(Math.min(now.getTime(), selected.end.getTime())) };
  const customerScope = scope(user);
  const [customers, deals] = await Promise.all([
    db.customer.findMany({ where: { ...customerScope, ...inquiryIn(period) }, select: { source: true, country: true, stage: true, isQualified: true } }),
    db.deal.findMany({ where: dealsIn(period, customerScope), select: { customerId: true, currency: true, dealAmount: true, customer: { select: { source: true, country: true } } } }),
  ]);
  const breakdown = (field: 'source' | 'country', label: (key: string) => string) => {
    const rows = new Map<string, Row>();
    const row = (raw: string | null) => {
      const key = raw?.trim() || '';
      if (!rows.has(key)) rows.set(key, { key, label: key ? label(key) : '未填写', inquiries: 0, qualified: 0, won: new Set(), deals: [] });
      return rows.get(key)!;
    };
    for (const customer of customers) { const r = row(customer[field]); r.inquiries++; if (isQualified(customer)) r.qualified++; }
    for (const deal of deals) { const r = row(deal.customer[field]); r.won.add(deal.customerId); r.deals.push({ currency: deal.currency, amount: deal.dealAmount }); }
    return [...rows.values()]
      .map(r => ({ key: r.key, label: r.label, inquiries: r.inquiries, qualified: r.qualified, qualifiedRate: rate(r.qualified, r.inquiries), wonCustomers: r.won.size, revenue: moneyByCurrency(r.deals) }))
      .sort((a, b) => b.inquiries - a.inquiries || b.wonCustomers - a.wonCustomers || a.label.localeCompare(b.label));
  };
  return {
    selected: { range: selected.range, startKey: selected.startKey, endKey: selected.endKey, label: selected.label },
    totals: {
      inquiries: customers.length,
      qualified: customers.filter(isQualified).length,
      wonCustomers: new Set(deals.map(deal => deal.customerId)).size,
      revenue: moneyByCurrency(deals.map(deal => ({ currency: deal.currency, amount: deal.dealAmount }))),
    },
    sources: breakdown('source', key => sources[key as keyof typeof sources] ?? key),
    countries: breakdown('country', key => key),
  };
}
export type SourcesAndCountries = Awaited<ReturnType<typeof sourcesAndCountries>>;
