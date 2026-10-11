import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import type { Actor } from '../lib/auth';
import { isQualified, moneyByCurrency } from '../lib/metrics';
import { businessCockpit } from '../services/business-cockpit-service';
import { salesPerformance } from '../services/sales-team-service';
import { sourcesAndCountries } from '../services/source-analysis-service';
import { financeOverview } from '../services/bos-v2-service';
import { deleteTestCustomers } from './identity-test-cleanup';

test('one rule per metric: qualified customers and money per currency', () => {
  assert.equal(isQualified({ stage: 'QUOTED', isQualified: null }), true, 'a quoted customer is a real buyer even if nobody ticked "qualified"');
  assert.equal(isQualified({ stage: 'CONTACTED', isQualified: true }), true);
  assert.equal(isQualified({ stage: 'CONTACTED', isQualified: null }), false);
  assert.equal(isQualified({ stage: 'INVALID', isQualified: true }), false, 'an invalid customer is never qualified');
  assert.deepEqual(moneyByCurrency([
    { currency: 'CNY', amount: new Prisma.Decimal(100) }, { currency: 'USD', amount: new Prisma.Decimal(300) }, { currency: 'CNY', amount: new Prisma.Decimal('0.5') }, { currency: 'EUR', amount: null },
  ]), [{ currency: 'USD', amount: '300.00' }, { currency: 'CNY', amount: '100.50' }]);
});

test('the cockpit, team, sources and finance pages show the same numbers for the same period', async () => {
  const adminRow = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const admin: Actor = { id: adminRow.id, name: adminRow.name, email: adminRow.email, role: adminRow.role };
  const tag = randomUUID().slice(0, 8);
  const sales = await db.user.create({ data: { name: `Metrics ${tag}`, email: `metrics-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const month = { range: 'month' };
  const read = async () => {
    const cockpit = await businessCockpit(admin, month);
    const currency = cockpit.currency as 'CNY' | 'USD' | 'EUR';
    const [team, sources, finance] = await Promise.all([salesPerformance(admin, { currency }), sourcesAndCountries(admin, month), financeOverview(admin, month)]);
    const amount = (list: { currency: string; amount: string }[]) => Number(list.find(item => item.currency === currency)?.amount ?? 0);
    const row = team.rows.find(r => r.id === sales.id);
    return {
      currency,
      newCustomers: [cockpit.kpis.newCustomers, team.company!.newCustomers, sources.totals.inquiries],
      qualified: [cockpit.funnel[1].count, team.company!.qualified, sources.totals.qualified],
      revenue: [cockpit.kpis.periodRevenue, Number(team.company!.revenue), amount(sources.totals.revenue), amount(finance.revenue)],
      orders: [cockpit.kpis.periodOrders, finance.orders],
      teamAddsUp: [team.rows.reduce((n, r) => n + r.newCustomers, 0) + team.others!.newCustomers, team.company!.newCustomers],
      salesRow: { newCustomers: row?.newCustomers ?? 0, deals: row?.deals ?? 0 },
      others: { newCustomers: team.others!.newCustomers, deals: team.others!.deals },
    };
  };
  const same = (values: number[], label: string) => assert.ok(values.every(v => v === values[0]), `${label} differs between pages: ${values.join(' / ')}`);
  const ids: string[] = [];
  try {
    const before = await read();
    for (const key of ['newCustomers', 'qualified', 'revenue', 'orders', 'teamAddsUp'] as const) same(before[key], key);

    const minuteAgo = new Date(Date.now() - 60_000);
    const make = async (data: Prisma.CustomerUncheckedCreateInput) => { const c = await db.customer.create({ data }); ids.push(c.id); return c; };
    // An unassigned lead (the pool) counts as a new inquiry on every page, including the team page.
    const pooled = await make({ name: `Pool ${tag}`, ownerId: admin.id, pendingAssignment: true, source: 'FACEBOOK', country: 'Germany' });
    const quoted = await make({ name: `Quoted ${tag}`, ownerId: sales.id, stage: 'QUOTED', source: 'TIKTOK', country: 'France' });
    await make({ name: `Ticked ${tag}`, ownerId: sales.id, stage: 'CONTACTED', isQualified: true, source: 'TIKTOK', country: 'France' });
    await make({ name: `Invalid ${tag}`, ownerId: sales.id, stage: 'INVALID', isQualified: true, source: 'WEBSITE' });
    const deleted = await make({ name: `Deleted ${tag}`, ownerId: sales.id, deletedAt: new Date(), stage: 'WON' });
    const deal = (customerId: string, amount: number, salespersonId: string | null) => db.deal.create({ data: {
      customerId, salespersonId, dealAmount: amount, productCost: amount / 2, grossProfit: amount / 2, grossMargin: 50, currency: before.currency, dealDate: minuteAgo } });
    await deal(quoted.id, 1000, sales.id);
    await deal(pooled.id, 500, null);
    await deal(deleted.id, 777, sales.id);
    const order = (customerId: string, status: string, n: number) => db.order.create({ data: {
      orderNo: `MET-${tag}-${n}`, customerId, amountRMB: 1000, status, orderDate: minuteAgo, notes: '', createdBy: admin.id } });
    await order(quoted.id, 'PENDING_PAYMENT', 1);
    await order(pooled.id, 'CANCELLED', 2);
    await order(deleted.id, 'PRODUCING', 3);

    const after = await read();
    for (const key of ['newCustomers', 'qualified', 'revenue', 'orders', 'teamAddsUp'] as const) same(after[key], key);
    assert.equal(after.newCustomers[0] - before.newCustomers[0], 4, 'pool + 3 live sales customers; the recycle bin is excluded');
    assert.equal(after.qualified[0] - before.qualified[0], 2, 'quoted + ticked; the invalid one is not qualified');
    assert.equal(after.revenue[0] - before.revenue[0], 1500, 'deals of live customers only');
    assert.equal(after.orders[0] - before.orders[0], 1, 'cancelled orders and recycle-bin customers are excluded');
    assert.deepEqual({ newCustomers: after.salesRow.newCustomers - before.salesRow.newCustomers, deals: after.salesRow.deals - before.salesRow.deals }, { newCustomers: 3, deals: 1 });
    assert.deepEqual({ newCustomers: after.others.newCustomers - before.others.newCustomers, deals: after.others.deals - before.others.deals }, { newCustomers: 1, deals: 1 });
  } finally {
    await deleteTestCustomers({ where: { id: { in: ids } } });
    await db.user.delete({ where: { id: sales.id } });
    await db.$disconnect();
  }
});
