import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { addDays, fixedItemsFor, lastFridayOf, monthGrid, rankToday, weekday } from '../lib/workbench';
import { createFocus, createItem, deleteFocus, planDay, updateItem, workbench } from '../services/workbench-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const HOUR = 3_600_000;

test('calendar rules: fixed rhythm, month grid, and the order of today\'s three things', () => {
  assert.deepEqual(fixedItemsFor('2026-10-19').map(i => i.title), ['广告周检 + 一周内容批量拍摄剪辑']);
  assert.deepEqual(fixedItemsFor('2026-10-21').map(i => i.title), ['查看话术测试进度（只看不改）']);
  assert.deepEqual(fixedItemsFor('2026-10-23').map(i => i.title), ['周漏斗复盘，定下周重心']);
  assert.equal(lastFridayOf('2026-10'), '2026-10-30');
  assert.deepEqual(fixedItemsFor('2026-10-30').map(i => i.title), ['周漏斗复盘，定下周重心', '定下月重心（3 条）'], 'the last Friday sets next month');
  assert.deepEqual(fixedItemsFor('2026-10-20'), []);
  assert.equal(weekday('2026-10-25'), 7);
  const grid = monthGrid('2026-10');
  assert.deepEqual([grid[0], grid[grid.length - 1], grid.length % 7], ['2026-09-28', '2026-11-01', 0]);
  const item = (id: string, kind: string, extra: Partial<{ pin: number; status: string; carryCount: number }> = {}) => ({ id, kind, pin: 0, status: 'TODO', carryCount: 0, ...extra });
  const ranked = rankToday([item('m', 'MANUAL'), item('f', 'FIXED'), item('s', 'SIGNAL'), item('w', 'FOCUS'), item('u', 'URGENT'), item('t', 'TIMEBLOCK'), item('p', 'MANUAL', { pin: 1 }), item('d', 'FOCUS', { status: 'DONE' })]);
  assert.deepEqual(ranked.top.map(i => i.id), ['u', 'p', 's'], 'urgent on top, then what a person pinned, then the order');
  assert.deepEqual(rankToday([item('a', 'MANUAL'), item('b', 'MANUAL', { carryCount: 2 })]).top.map(i => i.id), ['b', 'a'], 'carried items first among equals');
  assert.equal(rankToday([item('x', 'FIXED', { pin: -1 })]).top.length, 0, 'taken out of the three');
});

test('workbench: presets, today\'s plan, urgent leads on top, carried items, focus limits, signals replayed', async () => {
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const sales = await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } });
  const marker = `Bench${randomUUID().slice(0, 6)}`;
  const clean = async () => {
    await db.workItem.deleteMany({ where: { userId: admin.id } });
    await db.timeBlock.deleteMany({ where: { userId: admin.id } });
    await db.focusGoal.deleteMany({ where: { level: 'WEEK' } });
    await db.focusGoal.deleteMany({});
    await db.dailyAdInsight.deleteMany({ where: { reportKey: 'workbench-presets:2026Q4' } });
  };
  await clean();
  // Wednesday 21 October 2026, 10:00 in Shanghai.
  const now = new Date('2026-10-21T02:00:00Z');
  try {
    const plan = await planDay(admin, now);
    assert.deepEqual([plan.date, plan.fixed, plan.timeBlocks], ['2026-10-21', 1, 6]);
    assert.deepEqual(await planDay(admin, now), { ...plan, carried: 0 }, 'planning twice changes nothing');
    const day = await workbench(admin, {}, now);
    if (day.view !== 'day' || !('top' in day)) throw new Error('day view expected');
    assert.deepEqual(day.focus.months.map(m => m.title), ['广交会客户邀约到厂', '线索分级和跟进节奏执行', 'BOS新增字段上线']);
    assert.deepEqual(day.focus.weeks.map(w => [w.title, w.parentTitle]), [['广交会邀约全部发出', '广交会客户邀约到厂'], ['定好接送和到厂路线', '广交会客户邀约到厂']]);
    assert.equal(day.timeBlocks.length, 6);
    assert.equal(day.timeBlocks[0].startTime, '09:00');
    assert.ok([...day.top, ...day.others].some(i => i.title === '查看话术测试进度（只看不改）'));
    assert.equal(day.planned, true);
    const month = await workbench(admin, { view: 'month' }, now);
    if (!('days' in month) || month.view !== 'month') throw new Error('month view expected');
    const fair = month.days.find(d => d.key === '2026-10-25')!;
    assert.deepEqual('events' in fair ? fair.events.map(e => e.title) : [], ['广交会二期（家具展）'], 'the Canton Fair shows on every day it runs');

    // A new lead not answered within 5 minutes is the first thing today, in red; it leaves once contacted.
    const urgent = async () => {
      const view = await workbench(admin, {}, now);
      return 'top' in view ? view.top.find(i => i.id === 'urgent:first-reply') : undefined;
    };
    const baseline = Number((await urgent())?.title.match(/^(\d+)/)?.[1] ?? 0);
    const lead = await db.customer.create({ data: { name: `${marker} Lead`, ownerId: sales.id, source: 'FACEBOOK', leadGrade: 'A',
      assignedAt: new Date(now.getTime() - 15 * 60_000), firstContactDueAt: new Date(now.getTime() - 10 * 60_000), createdAt: new Date(now.getTime() - 15 * 60_000) } });
    const top = await workbench(admin, {}, now);
    if (!('top' in top)) throw new Error('day view expected');
    assert.equal(top.top[0].id, 'urgent:first-reply');
    assert.equal(top.top[0].tone, 'danger');
    assert.match(top.top[0].title, new RegExp(`^${baseline + 1} 条新线索超过 5 分钟未首回`));
    await db.customer.update({ where: { id: lead.id }, data: { firstContactAt: now } });
    assert.equal(Number((await urgent())?.title.match(/^(\d+)/)?.[1] ?? 0), baseline);

    // Not done yesterday: it is on today's list, carried once; another day without it raises the count.
    const yesterday = await createItem({ date: '2026-10-20', title: `${marker} 发广交会邀约`, category: 'CONVERT' }, admin);
    await planDay(admin, now);
    let carried = await db.workItem.findUniqueOrThrow({ where: { id: yesterday.id } });
    assert.deepEqual([carried.date, carried.carryCount, carried.originalDate], ['2026-10-21', 1, '2026-10-20']);
    await planDay(admin, new Date(now.getTime() + 24 * HOUR));
    carried = await db.workItem.findUniqueOrThrow({ where: { id: yesterday.id } });
    assert.deepEqual([carried.date, carried.carryCount], ['2026-10-22', 2]);
    await updateItem(yesterday.id, { status: 'DONE' }, admin);
    assert.ok((await db.workItem.findUniqueOrThrow({ where: { id: yesterday.id } })).doneAt);

    // Three focus goals at most per period; a week focus serves a month focus; a month focus with weeks stays.
    await assert.rejects(createFocus({ level: 'MONTH', periodKey: '2026-10', title: '第四条' }, admin), (e: { status?: number }) => e.status === 409);
    await assert.rejects(createFocus({ level: 'WEEK', periodKey: '2026-10-19', title: '没有月重心' }, admin), /必须关联一条月重心/);
    await assert.rejects(createFocus({ level: 'WEEK', periodKey: '2026-10-21', title: '不是周一', parentId: day.focus.months[0].id }, admin), /周一/);
    await assert.rejects(deleteFocus(day.focus.months[0].id, admin), (e: { status?: number }) => e.status === 409);

    // Focus signals, replayed: T0 replies at 30% for four weeks, then 10% this week → the light comes on; when this
    // week's replies arrive it goes out again.
    const customer = await db.customer.create({ data: { name: `${marker} Touches`, ownerId: sales.id } });
    const touches: string[] = [];
    for (let week = 0; week < 5; week++) for (let i = 0; i < 20; i++) {
      const sentAt = new Date(now.getTime() - 24 * HOUR - (week * 7 + 1) * 24 * HOUR - i * HOUR);
      const row = await db.outreachTouch.create({ data: { groupKey: `${marker}-${week}-${i}`, customerId: customer.id, kind: 'ICEBREAK', code: 'T0', sentAt, channel: 'PHONE',
        text: 'hi', contentHash: '0'.repeat(64), replied24h: week === 0 ? i < 2 : i < 6 } });
      if (week === 0) touches.push(row.id);
    }
    const signalKeys = async () => { const view = await workbench(admin, {}, now); return 'signals' in view ? view.signals.map(s => s.key) : []; };
    assert.ok((await signalKeys()).includes('reply-rate'));
    const lit = await workbench(admin, {}, now);
    assert.ok('top' in lit && lit.top.some(i => i.id === 'signal:reply-rate' && i.title === '话术：本周优先改首回话术'));
    await db.outreachTouch.updateMany({ where: { id: { in: touches.slice(0, 6) } }, data: { replied24h: true } });
    assert.equal((await signalKeys()).includes('reply-rate'), false, 'the condition is gone, so is the signal');
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
  } finally {
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await clean();
  }
});

test('workbench is the administrators\' page', async () => {
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  await assert.rejects(workbench(sales, {}), (e: { status?: number }) => e.status === 403);
  await assert.rejects(planDay(sales), (e: { status?: number }) => e.status === 403);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
