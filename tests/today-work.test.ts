import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import type { Actor } from '../lib/auth';
import { salesQueue, todayWorkCounts, workPriority } from '../services/bos-sales-service';
import { notificationFeed } from '../services/notification-service';
import { financeOverview } from '../services/finance-service';
import { getReminders } from '../services/workflow-service';
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

test('the work list puts the customer worth the next minute first, and says why', () => {
  const now = new Date('2026-10-14T08:00:00Z');
  const at = (n: number) => new Date(now.getTime() + n * 60_000);
  const none = { deadline: null, firstContactPending: false, leadGrade: '', aiIntent: 'UNKNOWN', aiScore: 0, lastInboundAt: null, lastOutboundAt: null, lastFollowUpAt: null, lastContactAt: null, staleQuoteSentAt: null };
  const rows = {
    lateA: workPriority({ ...none, deadline: at(-45), firstContactPending: true, leadGrade: 'A' }, now),
    soonA: workPriority({ ...none, deadline: at(30), firstContactPending: true, leadGrade: 'A' }, now),
    waiting: workPriority({ ...none, deadline: at(-20), lastInboundAt: at(-180), lastOutboundAt: at(-300) }, now),
    slipped: workPriority({ ...none, deadline: at(-5) }, now),
    later: workPriority({ ...none, deadline: at(300), aiIntent: 'HIGH', lastContactAt: at(-5 * 1440), staleQuoteSentAt: at(-4 * 1440) }, now),
    junk: workPriority({ ...none, deadline: at(-60), firstContactPending: true, leadGrade: 'D' }, now),
  };
  assert.deepEqual(rows.lateA.reasons, ['首联已超时 45 分钟', 'A 级表单']);
  assert.deepEqual(rows.soonA.reasons, ['30 分钟内首次联系', 'A 级表单']);
  assert.deepEqual(rows.waiting.reasons, ['跟进已超时 20 分钟', '客户在等回复 3 小时']);
  assert.deepEqual(rows.later.reasons, ['今天到期', 'AI 判断高意向', '报价 4 天未回复']);
  assert.deepEqual(rows.junk.reasons, ['首联已超时 1 小时', 'D 级表单']);
  const order = Object.entries(rows).sort((a, b) => b[1].score - a[1].score).map(([key]) => key);
  assert.deepEqual(order, ['lateA', 'waiting', 'soonA', 'slipped', 'later', 'junk']);
  // An answered message is not waiting any more.
  assert.deepEqual(workPriority({ ...none, lastInboundAt: at(-60), lastFollowUpAt: at(-30) }, now).reasons, []);
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

test('a backlog of old reminders does not hide new ones', async () => {
  const tag = randomUUID().slice(0, 8);
  const owner = await db.user.create({ data: { name: `Backlog ${tag}`, email: `backlog-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  try {
    // 60 tasks overdue for days, each with pending EARLY and OVERDUE reminders: 120 old reminders.
    const old = Array.from({ length: 60 }, (_, i) => ({ id: `backlog-${tag}-${i}`, title: `Old ${i}`, description: '', dueDate: minutes(-3 * 24 * 60 - i), createdBy: owner.id }));
    await db.task.createMany({ data: old });
    await db.reminder.createMany({ data: old.flatMap(t => [{ taskId: t.id, kind: 'EARLY', remindAt: new Date(t.dueDate.getTime() - 30 * 60_000) }, { taskId: t.id, kind: 'OVERDUE', remindAt: t.dueDate }]) });
    const fresh = await db.task.create({ data: { title: `Fresh ${tag}`, description: '', dueDate: minutes(20), createdBy: owner.id } });
    await db.reminder.create({ data: { taskId: fresh.id, kind: 'EARLY', remindAt: minutes(-10) } });
    assert.ok((await getReminders(actor(owner))).some(r => r.taskId === fresh.id), 'the newest reminder is announced');
  } finally {
    await db.task.deleteMany({ where: { createdBy: owner.id } });
    await db.user.delete({ where: { id: owner.id } });
    await db.$disconnect();
  }
});
