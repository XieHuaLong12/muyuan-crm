import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import type { Actor } from '../lib/auth';
import { salesQueue, todayWorkCounts } from '../services/bos-sales-service';
import { notificationFeed } from '../services/notification-service';
import { financeOverview } from '../services/bos-v2-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actor = (u: { id: string; name: string; email: string; role: string }): Actor => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

test('today\'s work is one list with one number, most urgent first', async () => {
  const tag = randomUUID().slice(0, 8);
  const owner = await db.user.create({ data: { name: `Today ${tag}`, email: `today-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const sales = actor(owner);
  try {
    const make = (name: string, data: Prisma.CustomerUncheckedCreateInput | object = {}) =>
      db.customer.create({ data: { name: `${name} ${tag}`, ownerId: owner.id, stage: 'CONTACTED', ...data } });
    // A: newly assigned, first contact due later today or tomorrow — still on today's list, not late.
    const fresh = await make('Fresh', { stage: 'NEW', assignedAt: minutes(-10), firstContactDueAt: minutes(180) });
    // B: follow-up date passed two hours ago.
    const late = await make('Late', { firstContactAt: minutes(-3000), nextFollowUpAt: minutes(-120) });
    // C: contacted, but a manual to-do (collect payment) was due half an hour ago.
    const payment = await make('Payment', { firstContactAt: minutes(-3000) });
    await db.task.create({ data: { customerId: payment.id, title: `催收尾款 ${tag}`, description: '', dueDate: minutes(-30), createdBy: owner.id } });
    // D: next follow-up is days away, and E is already won: neither is today's work.
    await make('Later', { firstContactAt: minutes(-3000), nextFollowUpAt: minutes(3 * 24 * 60) });
    await make('Won', { stage: 'WON', nextFollowUpAt: minutes(-60) });

    const counts = await todayWorkCounts(sales);
    assert.deepEqual(counts, { today: 3, todayOverdue: 2 });
    const queue = await salesQueue(sales, { queue: 'today' });
    assert.equal(queue.total, counts.today);
    assert.equal(queue.counts[0].key, 'today', 'today is the first tab');
    assert.equal(queue.counts[0].count, counts.today);
    assert.ok(!queue.counts.some(c => (c.key as string) === 'recent'), 'the full customer list is not repeated as a tab');
    assert.deepEqual(queue.customers.map(c => c.id), [late.id, payment.id, fresh.id]);
    assert.deepEqual(queue.customers[1].dueTasks.map(t => t.title), [`催收尾款 ${tag}`]);
    const feed = await notificationFeed(sales);
    assert.equal(feed.counts.today, counts.today);
    assert.equal(feed.counts.todayOverdue, counts.todayOverdue);
  } finally {
    await deleteTestCustomers({ where: { ownerId: owner.id } });
    await db.user.delete({ where: { id: owner.id } });
    await db.$disconnect();
  }
});

test('finance ignores deals of customers in the recycle bin', async () => {
  const admin = actor(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const tag = randomUUID().slice(0, 8);
  const revenue = async () => Number((await financeOverview(admin)).revenue.find(r => r.currency === 'CNY')?.amount ?? 0);
  const before = await revenue();
  const customer = await db.customer.create({ data: { name: `Finance ${tag}`, ownerId: admin.id } });
  try {
    await db.deal.create({ data: { customerId: customer.id, dealAmount: 1234.5, productCost: 1000, grossProfit: 234.5, grossMargin: 19, currency: 'CNY', dealDate: new Date() } });
    assert.equal(await revenue(), before + 1234.5);
    await db.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date() } });
    assert.equal(await revenue(), before);
    await assert.rejects(financeOverview({ ...admin, role: 'SALES' }), { status: 403 });
  } finally {
    await deleteTestCustomers({ where: { id: customer.id } });
    await db.$disconnect();
  }
});
