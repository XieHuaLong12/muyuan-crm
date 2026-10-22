import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { addDays, blockName, completion, fixedItemsFor, lastFridayOf, monthGrid, rankToday, reviewChanges, reviewStreak, weekday, type ReviewFields } from '../lib/workbench';
import { createFocus, createItem, deleteFocus, deleteItem, planDay, updateItem, workbench } from '../services/workbench-service';
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
  assert.equal(blockName('中东客户跟进，A类优先（迪拜 10:00–12:30）'), '中东客户跟进');
  assert.equal(blockName('CRM整理：回复夜间消息'), 'CRM整理');
});

test('review rules: the streak lets one unmarked day off through, rest days count for nothing, completion skips rest and drafts', () => {
  const S = (date: string, status = 'SUBMITTED') => ({ date, status });
  // 17th: nothing at all (a day off nobody marked) is let through; 19th: marked rest.
  assert.deepEqual(reviewStreak([S('2026-10-15'), S('2026-10-16'), S('2026-10-18'), S('2026-10-19', 'REST'), S('2026-10-20')], '2026-10-21'), { current: 4, longest: 4 });
  assert.deepEqual(reviewStreak([S('2026-10-15'), S('2026-10-18')], '2026-10-19'), { current: 1, longest: 1 }, 'two days with nothing end the run');
  assert.deepEqual(reviewStreak([S('2026-10-14'), S('2026-10-15'), S('2026-10-16', 'MISSED'), S('2026-10-17')], '2026-10-18'), { current: 1, longest: 2 }, 'a day not reviewed ends it');
  assert.deepEqual(reviewStreak([S('2026-10-17'), S('2026-10-18', 'DRAFT')], '2026-10-18'), { current: 1, longest: 1 }, 'today is still open');
  assert.deepEqual(reviewStreak([S('2026-10-17'), S('2026-10-18')], '2026-10-18'), { current: 2, longest: 2 }, 'today counts once reviewed');
  assert.deepEqual(reviewStreak([], '2026-10-18'), { current: 0, longest: 0 });
  assert.deepEqual(completion([{ status: 'SUBMITTED', done: 2, planned: 3 }, { status: 'MISSED', done: 1, planned: 3 }, { status: 'REST', done: 0, planned: 0 }, { status: 'DRAFT', done: 3, planned: 3 }]),
    { days: 2, done: 3, planned: 6, rate: 50 });
  assert.equal(completion([]).rate, null, 'no days, no rate');

  const item = { itemId: 'i1', title: '拍视频', category: 'FRONTEND', focusTitle: '', carryCount: 0, outcome: 'CARRIED' as const, reason: null, note: '' };
  const plan = (title: string) => ({ itemId: title, fixedKey: null, focusId: null, href: null, title, category: 'CONVERT', focusTitle: '', startTime: null, endTime: null, created: false });
  const before: ReviewFields = { items: [item], plan: [plan('回复 Marie')], wins: '先回完 A 类', problems: '', improvement: '早上拍视频', lastImprovement: null, energy: 4, focusLevel: null };
  const after: ReviewFields = { ...before, items: [{ ...item, reason: 'INTERRUPTED' }], plan: [plan('回复 Marie'), plan('周漏斗复盘')], improvement: '视频放到上午 10 点前拍完', energy: 4 };
  assert.deepEqual(reviewChanges(before, after).map(c => [c.label, c.before, c.after]), [
    ['「拍视频」', '顺延到明天', '顺延到明天 · 被打断'],
    ['明天改进', '早上拍视频', '视频放到上午 10 点前拍完'],
    ['明天的安排', '回复 Marie', '回复 Marie、周漏斗复盘'],
  ]);
  assert.deepEqual(reviewChanges(before, before), [], 'saving the same again changes nothing');
});

test('workbench: presets, today\'s plan, urgent leads on top, carried items, focus limits, signals replayed', async () => {
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const sales = await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } });
  const marker = `Bench${randomUUID().slice(0, 6)}`;
  const clean = async () => {
    await db.workItem.deleteMany({ where: { userId: admin.id } });
    await db.dailyReview.deleteMany({ where: { userId: admin.id } });
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
    assert.deepEqual([plan.date, plan.fixed, plan.timeBlocks, plan.placed], ['2026-10-21', 1, 6, 1]);
    assert.deepEqual(await planDay(admin, now), { ...plan, carried: 0, placed: 0 }, 'planning twice changes nothing');
    const day = await workbench(admin, now);
    assert.deepEqual(day.focus.months.map(m => m.title), ['广交会客户邀约到厂', '线索分级和跟进节奏执行', 'BOS新增字段上线']);
    assert.deepEqual(day.focus.weeks.map(w => [w.title, w.parentTitle]), [['广交会邀约全部发出', '广交会客户邀约到厂'], ['定好接送和到厂路线', '广交会客户邀约到厂']]);
    assert.equal(day.timeBlocks.length, 6);
    assert.equal(day.timeBlocks[0].startTime, '09:00');
    assert.deepEqual(day.three.map(i => [i.title, i.topOrder]), [['查看话术测试进度（只看不改）', 1]], 'the day starts with its three things fixed');
    assert.equal(day.review.status, 'NONE');
    const fair = await workbench(admin, new Date('2026-10-25T02:00:00Z'));
    assert.deepEqual(fair.events.map(e => e.title), ['广交会二期（家具展）'], 'the Canton Fair shows on every day it runs');

    // A new lead not answered within 5 minutes is on top, in red; it leaves once contacted.
    const urgent = async () => (await workbench(admin, now)).urgent.find(i => i.id === 'urgent:first-reply');
    const baseline = Number((await urgent())?.title.match(/^(\d+)/)?.[1] ?? 0);
    const lead = await db.customer.create({ data: { name: `${marker} Lead`, ownerId: sales.id, source: 'FACEBOOK', leadGrade: 'A',
      assignedAt: new Date(now.getTime() - 15 * 60_000), firstContactDueAt: new Date(now.getTime() - 10 * 60_000), createdAt: new Date(now.getTime() - 15 * 60_000) } });
    const top = await urgent();
    assert.equal(top?.tone, 'danger');
    assert.match(top?.title ?? '', new RegExp(`^${baseline + 1} 条新线索超过 5 分钟未首回`));
    await db.customer.update({ where: { id: lead.id }, data: { firstContactAt: now } });
    assert.equal(Number((await urgent())?.title.match(/^(\d+)/)?.[1] ?? 0), baseline);

    // Not done yesterday: it is on today's list, carried once; another day without it raises the count. The day
    // nobody reviewed is recorded the next morning with its three things as they stood.
    const yesterday = await createItem({ date: '2026-10-20', title: `${marker} 发广交会邀约`, category: 'CONVERT' }, admin);
    await planDay(admin, now);
    let carried = await db.workItem.findUniqueOrThrow({ where: { id: yesterday.id } });
    assert.deepEqual([carried.date, carried.carryCount, carried.originalDate], ['2026-10-21', 1, '2026-10-20']);
    const next = await planDay(admin, new Date(now.getTime() + 24 * HOUR));
    assert.equal(next.recorded, 1);
    const missed = await db.dailyReview.findUniqueOrThrow({ where: { userId_date: { userId: admin.id, date: '2026-10-21' } } });
    assert.deepEqual([missed.status, missed.done, missed.planned, missed.carried], ['MISSED', 0, 1, 1]);
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
    const signalKeys = async () => (await workbench(admin, now)).signals.map(s => s.key);
    assert.ok((await signalKeys()).includes('reply-rate'));
    await db.outreachTouch.updateMany({ where: { id: { in: touches.slice(0, 6) } }, data: { replied24h: true } });
    assert.equal((await signalKeys()).includes('reply-rate'), false, 'the condition is gone, so is the signal');

    // Deleting an item the system laid out drops it, so planning the day again does not bring it back.
    const friday = new Date('2026-10-23T02:00:00Z');
    await planDay(admin, friday);
    const funnel = await db.workItem.findFirstOrThrow({ where: { userId: admin.id, date: '2026-10-23', sourceKey: { startsWith: 'fixed:funnel:' } } });
    await deleteItem(funnel.id, admin);
    await planDay(admin, friday);
    assert.equal((await db.workItem.findUniqueOrThrow({ where: { id: funnel.id } })).status, 'DROPPED');
    assert.equal((await workbench(admin, friday)).three.some(i => i.id === funnel.id), false);
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
  } finally {
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await clean();
  }
});

test('workbench is the administrators\' page', async () => {
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  await assert.rejects(workbench(sales), (e: { status?: number }) => e.status === 403);
  await assert.rejects(planDay(sales), (e: { status?: number }) => e.status === 403);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
