import { deleteTestCustomers } from './identity-test-cleanup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { businessCockpit } from '../services/business-cockpit-service';

test('驾驶舱成交、报价与目标都遵循所选周期', async () => {
 const tag = randomUUID();
 const actor = await db.user.create({ data: { name: 'Cockpit period', email: `cockpit-${tag}@example.test`, passwordHash: 'test', role: 'ADMIN' } });
 const customer = await db.customer.create({ data: { name: 'Cockpit period customer', ownerId: actor.id, source: 'WEBSITE', createdAt: new Date('2037-03-03T04:00:00Z') } });
 const user = { id: actor.id, name: actor.name, email: actor.email, role: actor.role };
 const now = new Date('2037-03-15T04:00:00Z');
 const targets = [`YEAR-2037`, `MONTH-2037-1`, `MONTH-2037-2`, `MONTH-2037-3`];
 const createdTargetIds: string[] = [];
 const customerIds = [customer.id];
 try {
  const importedLater = await db.customer.create({ data: { name: 'Imported later', ownerId: actor.id, source: 'WEBSITE', createdAt: new Date('2037-03-04T04:00:00Z'), inquiryAt: new Date('2037-02-20T04:00:00Z') } });
  const correctedInquiry = await db.customer.create({ data: { name: 'Corrected inquiry', ownerId: actor.id, source: 'WEBSITE', createdAt: new Date('2037-02-04T04:00:00Z'), inquiryAt: new Date('2037-03-04T04:00:00Z') } });
  customerIds.push(importedLater.id, correctedInquiry.id);
  for (const data of [
   { periodKey: targets[0], periodType: 'YEAR', year: 2037, targetRevenue: 12000, currency: 'CNY' },
   ...[1, 2, 3].map(month => ({ periodKey: targets[month], periodType: 'MONTH', year: 2037, month, targetRevenue: 1000, currency: 'CNY' })),
  ]) createdTargetIds.push((await db.salesTarget.create({ data })).id);
  await db.deal.createMany({ data: [
   { customerId: customer.id, dealAmount: 700, productCost: 400, grossProfit: 300, grossMargin: 0.43, currency: 'CNY', dealDate: new Date('2037-02-20T04:00:00Z') },
   { customerId: customer.id, dealAmount: 300, productCost: 200, grossProfit: 100, grossMargin: 0.33, currency: 'CNY', dealDate: new Date('2037-03-05T04:00:00Z') },
  ] });
  await db.quotation.createMany({ data: [
   { customerId: customer.id, quoteNumber: `FEB-${tag}`, product: 'Sofa', quantity: 2, unitPrice: 100, currency: 'CNY', incoterm: 'FOB', notes: '', status: 'SENT', sentAt: new Date('2037-02-10T04:00:00Z'), createdBy: actor.id },
   { customerId: customer.id, quoteNumber: `MAR-${tag}`, product: 'Sofa', quantity: 5, unitPrice: 20, currency: 'CNY', incoterm: 'FOB', notes: '', status: 'SENT', sentAt: new Date('2037-03-03T04:00:00Z'), createdBy: actor.id },
  ] });
  const month = await businessCockpit(user, { range: 'month', trend: 'year' }, now);
  assert.equal(month.kpis.periodRevenue, 300);
  assert.equal(month.kpis.quotedAmount, 100);
  assert.equal(month.kpis.newCustomers, 2);
  assert.equal(month.funnel[0].count, 2);
  assert.equal(month.channels.find(channel => channel.id === 'WEBSITE')?.customers, 2);
  assert.equal(month.kpiTrends.newCustomers, 100);
  assert.equal(month.goal.periodGoal, 1000);
  assert.equal(month.kpis.completion, 30);
  assert.equal(month.trend.view, 'day');
  assert.equal(month.trend.points.reduce((sum, point) => sum + point.revenue, 0), 300);
  const year = await businessCockpit(user, { range: 'year' }, now);
  assert.equal(year.kpis.periodRevenue, 1000);
  assert.equal(year.kpis.quotedAmount, 300);
  assert.equal(year.kpis.newCustomers, 3);
  assert.equal(year.goal.periodGoal, 12000);
  assert.equal(year.trend.view, 'month');
  const today = await businessCockpit(user, { range: 'today', trend: 'year' }, now);
  assert.equal(today.kpis.periodRevenue, 0);
  assert.equal(today.kpis.newCustomers, 0);
  assert.equal(today.goal.periodGoal, null);
  assert.equal(today.trend.view, 'day');
 } finally {
  await db.quotation.deleteMany({ where: { customerId: customer.id } });
  await db.deal.deleteMany({ where: { customerId: customer.id } });
  await db.salesTarget.deleteMany({ where: { id: { in: createdTargetIds } } });
  await deleteTestCustomers({ where: { id: { in: customerIds } } });
  await db.user.delete({ where: { id: actor.id } });
  await db.$disconnect();
 }
});
