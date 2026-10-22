import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { createItem, planDay, stepFocus, updateFocus, updateItem, workbench } from '../services/workbench-service';
import { deliverReviewReminders, markRest, reviewDay, reviewHistory, saveReview } from '../services/daily-review-service';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const status = (code: number) => (e: { status?: number }) => e.status === code;
// Noon in Shanghai on a day of October 2026.
const noon = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T04:00:00Z`);

test('daily review: draft, submit, tomorrow planned, edits recorded, the next morning, a day missed, written late, rest, reminder', async () => {
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  const tag = randomUUID().slice(0, 6);
  const other = actorOf(await db.user.create({ data: { name: `Review ${tag}`, email: `review-${tag}@example.com`, passwordHash: 'x', role: 'ADMIN' } }));
  const clean = async () => {
    await db.workItem.deleteMany({ where: { userId: { in: [admin.id, other.id] } } });
    await db.dailyReview.deleteMany({ where: { userId: { in: [admin.id, other.id] } } });
    await db.timeBlock.deleteMany({ where: { userId: { in: [admin.id, other.id] } } });
    await db.focusGoal.deleteMany({ where: { level: 'WEEK' } });
    await db.focusGoal.deleteMany({});
    await db.dailyAdInsight.deleteMany({ where: { reportKey: 'workbench-presets:2026Q4' } });
  };
  await clean();
  try {
    // Wednesday 21 October: three things, one done.
    const day1 = noon(21);
    await planDay(admin, day1);
    await db.workItem.updateMany({ where: { userId: admin.id, date: '2026-10-21' }, data: { topOrder: null } });
    const ids: string[] = [];
    for (const title of ['约 Ahmed 周六到厂', '拍第 2 条邀约视频', '整理 B 类线索']) ids.push((await createItem({ date: '2026-10-21', title, pin: 1 }, admin)).id);
    await assert.rejects(createItem({ date: '2026-10-21', title: '第四件', pin: 1 }, admin), status(409), 'three things at most');
    await updateItem(ids[0], { status: 'DONE' }, admin);
    const today = await workbench(admin, day1);
    assert.deepEqual(today.three.map(i => [i.title, i.status]), [['约 Ahmed 周六到厂', 'DONE'], ['拍第 2 条邀约视频', 'TODO'], ['整理 B 类线索', 'TODO']], 'done stays among the three');

    // The review page: done as ticked, the rest carried by default and already on tomorrow's plan.
    let page = await reviewDay(admin, {}, day1);
    assert.deepEqual(page.items.map(i => i.outcome), ['DONE', 'CARRIED', 'CARRIED']);
    assert.deepEqual(page.plan.map(p => p.title), ['拍第 2 条邀约视频', '整理 B 类线索']);
    const weekFocus = (await db.focusGoal.findFirstOrThrow({ where: { level: 'WEEK', periodKey: '2026-10-19' }, orderBy: { sort: 'asc' } }));
    assert.ok(page.suggestions.some(s => s.focusId === weekFocus.id), 'the open week focus is suggested for tomorrow');
    assert.ok(page.suggestions.some(s => s.title === '查看话术测试进度（只看不改）'), 'and today\'s other open items');

    // A draft keeps what was written and changes nothing else.
    const answers = {
      date: '2026-10-21', wins: '上午先回完 A 类', problems: '下午被电话打断', improvement: '视频放到上午 10 点前拍完', energy: 4, focusLevel: 3,
      items: [{ itemId: ids[0], outcome: 'DONE' }, { itemId: ids[1], outcome: 'CARRIED', reason: 'INTERRUPTED', note: '两个临时电话' }, { itemId: ids[2], outcome: 'DROPPED', reason: 'PRIORITY' }],
      plan: [{ itemId: ids[1], startTime: '10:00', endTime: '11:00' }, { title: `${tag} 确认接送车辆`, category: 'CONVERT' }, { focusId: weekFocus.id }],
    };
    assert.deepEqual(await saveReview(admin, answers, day1), { date: '2026-10-21', status: 'DRAFT', changes: 0 });
    assert.equal((await db.workItem.findUniqueOrThrow({ where: { id: ids[2] } })).status, 'TODO', 'a draft does not touch the items');
    page = await reviewDay(admin, {}, day1);
    assert.deepEqual(page.items.map(i => [i.outcome, i.reason]), [['DONE', null], ['CARRIED', 'INTERRUPTED'], ['DROPPED', 'PRIORITY']]);
    assert.equal(page.wins, '上午先回完 A 类');

    // Submitting: carried moves to tomorrow first in line, dropped is dismissed, new things are made for tomorrow.
    await assert.rejects(saveReview(admin, { ...answers, submit: true, plan: [{ itemId: ids[0] }] }, day1), /已经完成或不做了/, 'only open things go to tomorrow');
    assert.deepEqual(await saveReview(admin, { ...answers, submit: true }, day1), { date: '2026-10-21', status: 'SUBMITTED', changes: 0 });
    const moved = await db.workItem.findUniqueOrThrow({ where: { id: ids[1] } });
    assert.deepEqual([moved.date, moved.carryCount, moved.topOrder, moved.startTime, moved.originalDate], ['2026-10-22', 1, 1, '10:00', '2026-10-21']);
    assert.equal((await db.workItem.findUniqueOrThrow({ where: { id: ids[2] } })).status, 'DROPPED');
    const tomorrow = await db.workItem.findMany({ where: { userId: admin.id, date: '2026-10-22', topOrder: { not: null } }, orderBy: { topOrder: 'asc' } });
    assert.deepEqual(tomorrow.map(i => [i.title, i.topOrder, i.kind]), [['拍第 2 条邀约视频', 1, 'MANUAL'], [`${tag} 确认接送车辆`, 2, 'MANUAL'], [weekFocus.title, 3, 'FOCUS']]);
    let review = await db.dailyReview.findUniqueOrThrow({ where: { userId_date: { userId: admin.id, date: '2026-10-21' } }, include: { revisions: true } });
    assert.deepEqual([review.status, review.done, review.planned, review.carried, review.dropped, review.revisions.map(r => r.kind)], ['SUBMITTED', 1, 3, 1, 1, ['SUBMIT']]);
    assert.ok(review.metrics, 'the day\'s numbers are kept with the review');
    assert.equal((await workbench(admin, day1)).review.status, 'SUBMITTED');

    // Changed the same evening: every change is recorded with what it was; what the review made and is no longer planned goes.
    page = await reviewDay(admin, {}, day1);
    const kept = page.plan.filter(p => p.title !== `${tag} 确认接送车辆`).map(p => ({ itemId: p.itemId, startTime: p.startTime, endTime: p.endTime }));
    assert.deepEqual(await saveReview(admin, { ...answers, submit: true, wins: '上午先回完 A 类，Ahmed 确认周六到厂', plan: kept }, day1), { date: '2026-10-21', status: 'SUBMITTED', changes: 2 });
    assert.equal(await db.workItem.count({ where: { userId: admin.id, title: `${tag} 确认接送车辆` } }), 0);
    assert.deepEqual(await saveReview(admin, { ...answers, submit: true, wins: '上午先回完 A 类，Ahmed 确认周六到厂', plan: kept }, day1), { date: '2026-10-21', status: 'SUBMITTED', changes: 0 }, 'the same again records nothing');
    review = await db.dailyReview.findUniqueOrThrow({ where: { userId_date: { userId: admin.id, date: '2026-10-21' } }, include: { revisions: { orderBy: { createdAt: 'asc' } } } });
    assert.deepEqual(review.revisions.map(r => r.kind), ['SUBMIT', 'EDIT']);
    assert.deepEqual((review.revisions[1].changes as { label: string; before: string }[]).map(c => [c.label, c.before]), [['做得好的', '上午先回完 A 类'], ['明天的安排', `拍第 2 条邀约视频、${tag} 确认接送车辆、${weekFocus.title}`]]);

    // The focus with a number target: each step is recorded with the day.
    const month = await db.focusGoal.findFirstOrThrow({ where: { level: 'MONTH', periodKey: '2026-10' }, orderBy: { sort: 'asc' } });
    await assert.rejects(stepFocus(month.id, { delta: 1 }, admin, day1), /目标数/);
    await updateFocus(month.id, { targetValue: 10, currentValue: 5, unit: '位' }, admin, day1);
    assert.deepEqual(await stepFocus(month.id, { delta: 1 }, admin, day1), { id: month.id, currentValue: 6, today: 1 });
    assert.equal((await db.focusGoal.findUniqueOrThrow({ where: { id: month.id } })).progress, 60);
    await assert.rejects(stepFocus(month.id, { delta: 2 }, admin, day1), /每次加一或减一/);

    // Thursday: the three things planned last night, and how yesterday went.
    const day2 = noon(22);
    const plan2 = await planDay(admin, day2);
    assert.deepEqual([plan2.recorded, plan2.placed], [0, 0], 'a reviewed day needs no record; last night placed today\'s three');
    const thursday = await workbench(admin, day2);
    assert.deepEqual(thursday.three.map(i => i.title), ['拍第 2 条邀约视频', weekFocus.title]);
    assert.ok(thursday.plannedAt);
    assert.deepEqual([thursday.stats.yesterday, thursday.stats.streak, thursday.lastImprovement?.text], [{ done: 1, planned: 3 }, 1, '视频放到上午 10 点前拍完']);
    page = await reviewDay(admin, {}, day2);
    assert.equal(page.previousImprovement?.text, '视频放到上午 10 点前拍完');
    await saveReview(admin, { date: '2026-10-22', submit: true, lastImprovement: 'YES', items: page.items.map(i => ({ itemId: i.itemId, outcome: 'DONE' })), plan: [] }, day2);

    // Friday nobody reviews; Saturday morning it is recorded as it stood.
    await planDay(admin, noon(23));
    const plan4 = await planDay(admin, noon(24));
    assert.equal(plan4.recorded, 1);
    const friday = await db.dailyReview.findUniqueOrThrow({ where: { userId_date: { userId: admin.id, date: '2026-10-23' } } });
    assert.equal(friday.status, 'MISSED');

    // Only the author sees a review: another administrator has their own empty record and cannot write into it.
    const theirs = await reviewHistory(other, { month: '2026-10' }, noon(24));
    assert.deepEqual([theirs.journal.length, theirs.stats.streak.longest], [0, 0]);
    await assert.rejects(saveReview(other, { ...answers, submit: true, plan: [] }, day1), status(400));
    await assert.rejects(reviewDay(sales, {}, day1), status(403));

    // Written late: the outcomes stay as recorded, the reasons and answers are added.
    const fridayItem = (friday.items as { itemId: string; outcome: string }[])[0];
    await saveReview(admin, { date: '2026-10-23', submit: true, wins: '补写：广交会第一天', items: fridayItem ? [{ itemId: fridayItem.itemId, outcome: 'DONE', reason: 'TIME' }] : [] }, noon(24));
    const late = await db.dailyReview.findUniqueOrThrow({ where: { userId_date: { userId: admin.id, date: '2026-10-23' } } });
    assert.equal(late.status, 'SUBMITTED');
    const first = (late.items as { itemId: string; outcome: string; reason: string | null }[]).find(i => i.itemId === fridayItem?.itemId);
    if (fridayItem) assert.deepEqual([first?.outcome, first?.reason], [fridayItem.outcome, fridayItem.outcome === 'DONE' ? null : 'TIME']);
    await assert.rejects(saveReview(admin, { date: '2026-10-25', submit: true }, noon(24)), /还没到这一天/);
    await assert.rejects(saveReview(admin, { date: '2026-09-01', submit: true }, noon(24)), /30 天/);
    await assert.rejects(saveReview(admin, { date: '2026-10-23' }, noon(24)), /直接提交/);

    // The record: the month at a glance, the streak, reasons, improvements kept, every change.
    const history = await reviewHistory(admin, { month: '2026-10' }, noon(24));
    const statusOf = (key: string) => history.days.find(d => d.key === key)?.status;
    assert.deepEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].map(statusOf), ['SUBMITTED', 'SUBMITTED', 'SUBMITTED', 'OPEN']);
    assert.deepEqual(history.stats.streak, { current: 3, longest: 3 });
    assert.deepEqual(history.reasons.filter(r => r.key !== 'TIME').map(r => [r.key, r.count]).sort(), [['INTERRUPTED', 1], ['PRIORITY', 1]]);
    assert.deepEqual(history.improvements.find(i => i.date === '2026-10-21'), { date: '2026-10-21', text: '视频放到上午 10 点前拍完', result: 'YES' });
    const entry = history.journal.find(j => j.date === '2026-10-21')!;
    assert.deepEqual([entry.revisions.length, entry.plan.length, entry.focusChanges.map(f => [f.from, f.to])], [2, 2, [[5, 6]]]);
    assert.equal(history.journal.find(j => j.date === '2026-10-23')?.late, true);
    assert.deepEqual((await reviewHistory(admin, { month: '2026-10', q: 'Ahmed' }, noon(24))).journal.map(j => j.date), ['2026-10-21'], 'search finds what was written');

    // A day off: no reminder, not counted, the streak goes on. The reminder goes once, at 21:30, to whoever has not reviewed.
    const night = (day: number, time: string) => new Date(`2026-10-${day}T${time}:00+08:00`);
    assert.deepEqual(await deliverReviewReminders(night(24, '21:00')), { reminded: 0, pushed: 0 }, 'not before 21:30');
    await deliverReviewReminders(night(24, '21:31'));
    assert.ok((await db.dailyReview.findUniqueOrThrow({ where: { userId_date: { userId: admin.id, date: '2026-10-24' } } })).remindedAt, 'Saturday too');
    assert.equal((await deliverReviewReminders(night(24, '21:40'))).reminded, 0, 'once a day');
    await markRest(admin, { date: '2026-10-25' }, noon(25));
    await deliverReviewReminders(night(25, '21:35'));
    assert.equal((await db.dailyReview.findUniqueOrThrow({ where: { userId_date: { userId: admin.id, date: '2026-10-25' } } })).remindedAt, null, 'a day off gets no reminder');
    await assert.rejects(markRest(admin, { date: '2026-10-22' }, noon(25)), status(409), 'a reviewed day is not a day off');
  } finally {
    await clean();
    await db.user.delete({ where: { id: other.id } });
  }
});
