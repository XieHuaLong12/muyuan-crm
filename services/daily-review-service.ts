import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { inquiryIn } from '@/lib/metrics';
import { categoryEnum, focusSignals, type Category } from '@/lib/outreach';
import { retryTransaction } from '@/lib/transaction-retry';
import {
  REASONS, REVIEW_REMINDER, addDays, blockName, completion, countOutcomes, daysBetween, fixedItemsFor, mondayOf, monthGrid, monthOf, reviewChanges, reviewStreak, weekday,
  type PlanItem, type Reason, type ReviewFields, type ReviewItem,
} from '@/lib/workbench';
import { sendPush } from './push-service';
import { currentCustomers } from '@/lib/customer-group';
import {
  DATE, THREE_KINDS, TIME, dayChange, energyView, focusGoals, ignoreDuplicate, localStart, settings, signalInput, snapshotOf, snapshotSelect, urgentItems, weekFocus,
} from './workbench-service';

/**
 * 每日复盘 (docs/OUTREACH_AND_WORKBENCH.md): every evening the operations lead looks back at the day's three things
 * (done, carried to tomorrow, or dropped, and why), answers three questions, rates energy and focus, and plans
 * tomorrow's three things. Everything is kept: a submitted review can still be changed, and each change is recorded
 * with what it was before. Reviews belong to the person who wrote them: nobody else can read them, administrators
 * included. A day nobody reviewed is recorded by the system the next morning (services/workbench-service.ts).
 */
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份格式应为 yyyy-MM');
/** How far back a review can still be written. */
const BACKFILL_DAYS = 30;
const ADMIN_ONLY = '每日复盘仅管理员可用';

const storedItems = (value: Prisma.JsonValue | undefined): ReviewItem[] => Array.isArray(value) ? value as unknown as ReviewItem[] : [];
const storedPlan = (value: Prisma.JsonValue | undefined): PlanItem[] => Array.isArray(value) ? value as unknown as PlanItem[] : [];
const json = (value: unknown) => value as Prisma.InputJsonValue;

function checkDate(date: string, today: string) {
  if (date > today) throw new HttpError(400, '还没到这一天：明天的事在今天的复盘里安排');
  if (date < addDays(today, -BACKFILL_DAYS)) throw new HttpError(400, `只能补写 ${BACKFILL_DAYS} 天内的复盘`);
}

/** The day's three things as they stand now. */
async function liveThree(userId: string, date: string) {
  return snapshotOf(await db.workItem.findMany({ where: { userId, date, topOrder: { not: null }, kind: { in: THREE_KINDS } }, select: snapshotSelect }));
}

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
/** The day in numbers, from BOS data, kept with the review: new leads, how fast they were answered, customer replies, quotations sent. */
async function dayMetrics(date: string, tz: string) {
  const start = localStart(date, tz), end = localStart(addDays(date, 1), tz);
  const [leads, replies, quotes, weekQuotes] = await Promise.all([
    db.customer.findMany({ where: { deletedAt: null, ...inquiryIn({ start, end }) }, select: { leadGrade: true, createdAt: true, firstContactAt: true, contactedAt: true, lastOutboundAt: true } }),
    db.outreachReply.findMany({ where: { receivedAt: { gte: start, lt: end }, customer: { AND: [{ deletedAt: null }, currentCustomers] } }, select: { quality: true } }),
    db.quotation.count({ where: { sentAt: { gte: start, lt: end } } }),
    db.quotation.count({ where: { sentAt: { gte: localStart(mondayOf(date), tz), lt: end } } }),
  ]);
  const firstTouch = (l: (typeof leads)[number]) => [l.firstContactAt, l.contactedAt, l.lastOutboundAt].filter((d): d is Date => !!d).sort((x, y) => x.getTime() - y.getTime())[0];
  const minutes = leads.flatMap(l => { const at = firstTouch(l); return at ? [minutesBetween(l.createdAt, at)] : []; });
  return {
    leads: leads.length, businessLeads: leads.filter(l => l.leadGrade === 'A' || l.leadGrade === 'B').length,
    answered: minutes.length, firstReplyMinutes: minutes.length ? Math.round(minutes.reduce((sum, m) => sum + m, 0) / minutes.length) : null,
    replies: replies.length, highReplies: replies.filter(r => r.quality === 'HIGH').length, quotes, weekQuotes,
  };
}
export type DayMetrics = Awaited<ReturnType<typeof dayMetrics>>;

// ───────────────────────── The review page ─────────────────────────

export const reviewQuery = z.object({ date: DATE.optional() });

/** Things to pick from for tomorrow: its fixed items, open week focus, customers waiting, focus signals, today's other open items. */
async function suggestions(userId: string, date: string, now: Date) {
  const { tz, config } = await settings(now);
  const tomorrow = addDays(date, 1);
  const [{ weeks }, urgent, facts, others] = await Promise.all([
    focusGoals(monthOf(tomorrow), mondayOf(tomorrow)),
    urgentItems(now, config),
    signalInput(userId, now, tz, config),
    db.workItem.findMany({ where: { userId, date, status: 'TODO', topOrder: null, kind: { in: THREE_KINDS } }, select: { id: true, title: true, category: true }, take: 5 }),
  ]);
  type Suggestion = { key: string; title: string; detail: string; category: string; itemId: string | null; fixedKey: string | null; focusId: string | null; href: string | null };
  const list: Suggestion[] = [];
  const none = { itemId: null, fixedKey: null, focusId: null, href: null };
  for (const f of fixedItemsFor(tomorrow)) list.push({ ...none, key: `fixed:${f.sourceKey}`, title: f.title, detail: '明天的固定事项', category: f.category, fixedKey: f.sourceKey, href: f.href });
  for (const w of weeks.filter(w => w.status !== 'DONE')) list.push({ ...none, key: `focus:${w.id}`, title: w.title, detail: '本周重心', category: w.category, focusId: w.id });
  const hot = urgent.find(i => i.id === 'urgent:hot-reply');
  if (hot) list.push({ ...none, key: 'hot-reply', title: `回复 ${hot.detail}`, detail: hot.title, category: 'CONVERT', href: hot.href });
  for (const s of focusSignals(facts, config).filter(s => !s.key.startsWith('energy:'))) {
    list.push({ ...none, key: `signal:${s.key}`, title: `${s.title}：${s.focus.replace(/^[^：]+：/, '')}`, detail: s.detail, category: s.category, href: s.href });
  }
  for (const item of others) list.push({ ...none, key: `item:${item.id}`, title: item.title, detail: '今天的其他事项', category: item.category, itemId: item.id });
  return list.filter((s, index) => list.findIndex(t => t.title === s.title) === index).slice(0, 8);
}

/**
 * The review of a day (today by default, or a day in the last 30 to write it late). Today's three things come live,
 * with what a draft already chose; a submitted or system-recorded day shows them as kept. Tomorrow's plan, the time
 * blocks to put things in and the suggestions only concern today.
 */
export async function reviewDay(user: Actor, input: unknown = {}, now = new Date()) {
  requireAdmin(user, ADMIN_ONLY);
  const { tz, today } = await settings(now);
  const date = reviewQuery.parse(input).date ?? today;
  checkDate(date, today);
  const isToday = date === today, tomorrow = addDays(date, 1);
  const review = await db.dailyReview.findUnique({ where: { userId_date: { userId: user.id, date } }, include: { revisions: { orderBy: { createdAt: 'asc' } } } });
  const kept = review?.status === 'SUBMITTED' || review?.status === 'MISSED';
  const draft = storedItems(review?.items);
  const items = kept ? storedItems(review.items) : (await liveThree(user.id, date)).map(i => {
    const chosen = draft.find(d => d.itemId === i.itemId);
    return chosen ? { ...i, outcome: chosen.outcome, reason: chosen.reason, note: chosen.note } : i;
  });
  const [rows, others, month, previous, blocks] = await Promise.all([
    db.workItem.findMany({ where: { userId: user.id, id: { in: items.map(i => i.itemId) } }, select: { id: true, doneAt: true } }),
    db.workItem.groupBy({ by: ['status'], where: { userId: user.id, date, topOrder: null, kind: { in: THREE_KINDS }, status: { not: 'DROPPED' } }, _count: { _all: true } }),
    focusGoals(monthOf(date), mondayOf(date)),
    db.dailyReview.findFirst({ where: { userId: user.id, date: { lt: date }, status: 'SUBMITTED', improvement: { not: '' } }, orderBy: { date: 'desc' }, select: { date: true, improvement: true } }),
    db.timeBlock.findMany({ where: { userId: user.id, active: true }, orderBy: [{ startTime: 'asc' }, { sort: 'asc' }] }),
  ]);
  const doneAt = new Map(rows.map(r => [r.id, r.doneAt?.toISOString() ?? null]));
  // Tomorrow's plan: as saved, or else what is being carried over.
  const plan = review && (kept || storedPlan(review.plan).length) ? storedPlan(review.plan)
    : items.filter(i => i.outcome === 'CARRIED').map((i): PlanItem => ({ itemId: i.itemId, fixedKey: null, focusId: null, href: null, title: i.title, category: i.category,
      focusTitle: i.focusTitle, startTime: null, endTime: null, created: false }));
  return {
    date, today, tomorrow, isToday, timezone: tz, clock: formatInTimeZone(now, tz, 'HH:mm'),
    status: review?.status ?? 'NONE', submittedAt: review?.submittedAt?.toISOString() ?? null,
    revisions: (review?.revisions ?? []).map(r => ({ kind: r.kind, createdAt: r.createdAt.toISOString(), changes: r.changes })),
    items: items.map(i => ({ ...i, doneAt: doneAt.get(i.itemId) ?? null })),
    others: { done: others.find(o => o.status === 'DONE')?._count._all ?? 0, total: others.reduce((sum, o) => sum + o._count._all, 0) },
    metrics: (review?.metrics as DayMetrics | null) ?? await dayMetrics(date, tz),
    focus: await Promise.all(month.months.map(async m => ({ id: m.id, title: m.title, targetValue: m.targetValue, currentValue: m.currentValue, unit: m.unit, progress: m.progress,
      change: await dayChange(m.id, user.id, date) }))),
    previousImprovement: previous ? { date: previous.date, text: previous.improvement } : null,
    lastImprovement: review?.lastImprovement ?? null, wins: review?.wins ?? '', problems: review?.problems ?? '', improvement: review?.improvement ?? '',
    energy: review?.energy ?? null, focusLevel: review?.focusLevel ?? null,
    plan,
    blocks: isToday ? blocks.filter(b => b.weekdays.split(',').map(Number).includes(weekday(tomorrow)))
      .map(b => ({ startTime: b.startTime, endTime: b.endTime, title: b.title, name: blockName(b.title) })) : [],
    suggestions: isToday ? await suggestions(user.id, date, now) : [],
  };
}
export type ReviewData = Awaited<ReturnType<typeof reviewDay>>;

// ───────────────────────── Saving ─────────────────────────

const planEntry = z.object({
  itemId: z.string().trim().max(191).nullable().default(null),
  fixedKey: z.string().trim().max(120).nullable().default(null),
  focusId: z.string().trim().max(191).nullable().default(null),
  href: z.string().trim().max(300).regex(/^\/(?!\/)/, '链接只能指向本系统的页面').nullable().default(null),
  title: z.string().trim().max(200, '事项不能超过 200 字').default(''),
  category: categoryEnum.default('CONVERT'),
  startTime: TIME.nullable().default(null), endTime: TIME.nullable().default(null),
}).refine(v => v.itemId || v.fixedKey || v.focusId || v.title, { message: '请填写明天的事项', path: ['title'] });
const reviewInput = z.object({
  date: DATE,
  submit: z.boolean().default(false),
  items: z.array(z.object({
    itemId: z.string().trim().min(1).max(191),
    outcome: z.enum(['DONE', 'CARRIED', 'DROPPED']),
    reason: z.enum(['TIME', 'INTERRUPTED', 'PRIORITY', 'STUCK', 'OTHER']).nullable().default(null),
    note: z.string().trim().max(200, '补充不能超过 200 字').default(''),
  })).max(20).default([]),
  lastImprovement: z.enum(['YES', 'PARTLY', 'NO']).nullable().default(null),
  wins: z.string().trim().max(1000, '「做得好的」不能超过 1000 字').default(''),
  problems: z.string().trim().max(1000, '「遇到的问题」不能超过 1000 字').default(''),
  improvement: z.string().trim().max(200, '「明天改进」不能超过 200 字').default(''),
  energy: z.coerce.number().int().min(1).max(5).nullable().default(null),
  focusLevel: z.coerce.number().int().min(1).max(5).nullable().default(null),
  plan: z.array(planEntry).max(8, '明天最多排 8 件').default([]),
});
type PlanEntry = z.infer<typeof planEntry>;

/** Tomorrow's entries with their titles, checked: only open items of this user, tomorrow's own fixed items, this week's focus. */
async function resolvePlan(userId: string, date: string, entries: PlanEntry[], items: ReviewItem[], before: PlanItem[]): Promise<PlanItem[]> {
  const tomorrow = addDays(date, 1);
  const ids = entries.map(e => e.itemId).filter((id): id is string => !!id);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, '明天的安排里有重复的事项');
  const rows = await db.workItem.findMany({ where: { userId, id: { in: ids } }, select: { id: true, title: true, category: true, status: true, date: true, focus: { select: { title: true } } } });
  const fixed = fixedItemsFor(tomorrow);
  const plan: PlanItem[] = [];
  for (const entry of entries) {
    const base = { fixedKey: null, focusId: null, href: entry.href, startTime: entry.startTime, endTime: entry.endTime };
    if (entry.itemId) {
      const row = rows.find(r => r.id === entry.itemId);
      const inThree = items.find(i => i.itemId === entry.itemId);
      if (!row) throw new HttpError(400, '明天的安排里有事项不存在');
      if (inThree ? inThree.outcome !== 'CARRIED' : row.status !== 'TODO' || row.date < date) throw new HttpError(400, `「${row.title}」已经完成或不做了，不用排到明天`);
      plan.push({ ...base, itemId: row.id, href: null, title: row.title, category: row.category, focusTitle: row.focus?.title ?? '',
        created: before.some(p => p.itemId === row.id && p.created) });
    } else if (entry.fixedKey) {
      const item = fixed.find(f => f.sourceKey === entry.fixedKey);
      if (!item) throw new HttpError(400, '这件固定事项不在明天');
      plan.push({ ...base, itemId: '', fixedKey: item.sourceKey, href: item.href, title: item.title, category: item.category, focusTitle: '', created: false });
    } else {
      const focus = await weekFocus(entry.focusId);
      plan.push({ ...base, itemId: '', focusId: focus?.id ?? null, title: entry.title || focus?.title || '', category: focus?.category ?? entry.category, focusTitle: focus?.title ?? '', created: true });
    }
  }
  return plan;
}

/**
 * Puts today's review into the work items, idempotently (an edit the same evening applies again): done stays on
 * today; dropped is dismissed; carried moves to tomorrow with one more carry. Then tomorrow's plan: the first three
 * are tomorrow's three things, the rest wait among the other items; what an earlier save of this review made and is
 * no longer planned is removed.
 */
async function applyToday(tx: Prisma.TransactionClient, userId: string, date: string, items: ReviewItem[], plan: PlanItem[], before: PlanItem[], now: Date) {
  const tomorrow = addDays(date, 1);
  for (const [index, item] of items.entries()) {
    const row = await tx.workItem.findFirst({ where: { id: item.itemId, userId } });
    if (!row) continue;
    const data: Prisma.WorkItemUpdateInput = item.outcome === 'DONE' ? { status: 'DONE', doneAt: row.doneAt ?? now, date, carryCount: item.carryCount, topOrder: index + 1 }
      : item.outcome === 'DROPPED' ? { status: 'DROPPED', doneAt: null, date, carryCount: item.carryCount, topOrder: index + 1 }
      : { status: 'TODO', doneAt: null, date: tomorrow, carryCount: item.carryCount + 1, originalDate: row.originalDate ?? date, topOrder: null };
    await tx.workItem.update({ where: { id: row.id }, data }).catch(ignoreDuplicate);
  }
  await tx.workItem.updateMany({ where: { userId, date: tomorrow, topOrder: { not: null } }, data: { topOrder: null } });
  const kept: PlanItem[] = [];
  for (const [index, entry] of plan.entries()) {
    const topOrder = index < 3 ? index + 1 : null, time = { startTime: entry.startTime, endTime: entry.endTime };
    if (entry.itemId) {
      const row = await tx.workItem.findFirst({ where: { id: entry.itemId, userId } });
      if (!row) continue;
      const moving = row.date < tomorrow && !items.some(i => i.itemId === row.id);
      await tx.workItem.update({ where: { id: row.id }, data: { date: tomorrow, topOrder, ...time, status: 'TODO', doneAt: null,
        ...(moving ? { carryCount: row.carryCount + daysBetween(row.date, tomorrow), originalDate: row.originalDate ?? row.date } : {}) } }).catch(ignoreDuplicate);
      kept.push(entry);
    } else if (entry.fixedKey) {
      const fixed = fixedItemsFor(tomorrow).find(f => f.sourceKey === entry.fixedKey)!;
      const row = await tx.workItem.upsert({ where: { userId_date_sourceKey: { userId, date: tomorrow, sourceKey: fixed.sourceKey } }, update: { topOrder, ...time, status: 'TODO' },
        create: { userId, date: tomorrow, sourceKey: fixed.sourceKey, kind: 'FIXED', title: fixed.title, detail: fixed.detail, category: fixed.category, href: fixed.href, topOrder, ...time } });
      kept.push({ ...entry, itemId: row.id });
    } else {
      const row = await tx.workItem.create({ data: { userId, date: tomorrow, title: entry.title, category: entry.category, kind: entry.focusId ? 'FOCUS' : 'MANUAL', focusId: entry.focusId,
        href: entry.href, pin: 1, topOrder, ...time } });
      kept.push({ ...entry, itemId: row.id, created: true });
    }
  }
  for (const old of before.filter(p => p.created && p.itemId && !kept.some(k => k.itemId === p.itemId))) {
    await tx.workItem.deleteMany({ where: { id: old.itemId, userId, date: tomorrow, status: 'TODO' } });
  }
  return kept;
}

const fieldsOf = (row: { items: Prisma.JsonValue; plan: Prisma.JsonValue; wins: string; problems: string; improvement: string; lastImprovement: string | null; energy: number | null; focusLevel: number | null }): ReviewFields =>
  ({ items: storedItems(row.items), plan: storedPlan(row.plan), wins: row.wins, problems: row.problems, improvement: row.improvement, lastImprovement: row.lastImprovement,
    energy: row.energy, focusLevel: row.focusLevel });

/**
 * Saves a review. A draft (today only) just keeps what was written. Submitting records it, applies today's choices
 * to the work items and plans tomorrow; saving a submitted review again records what changed. On a past day the
 * outcomes and the plan stay as they were: reasons, notes, the three questions and the ratings can still be written.
 */
export async function saveReview(user: Actor, input: unknown, now = new Date()) {
  requireAdmin(user, ADMIN_ONLY);
  const v = reviewInput.parse(input);
  const { tz, today } = await settings(now);
  checkDate(v.date, today);
  const isToday = v.date === today;
  if (!isToday && !v.submit) throw new HttpError(400, '补写的复盘请直接提交');
  const review = await db.dailyReview.findUnique({ where: { userId_date: { userId: user.id, date: v.date } } });
  const submitted = review?.status === 'SUBMITTED';
  const kept = submitted || review?.status === 'MISSED';
  const base = kept ? storedItems(review!.items) : await liveThree(user.id, v.date);
  const unknown = v.items.find(i => !base.some(b => b.itemId === i.itemId));
  if (unknown) throw new HttpError(400, '有事项不是这一天的三件事，请刷新后再复盘');
  const items: ReviewItem[] = base.map(item => {
    const chosen = v.items.find(i => i.itemId === item.itemId);
    if (!chosen) return item;
    const outcome = isToday ? chosen.outcome : item.outcome;
    return { ...item, outcome, reason: outcome === 'DONE' ? null : chosen.reason as Reason | null, note: chosen.note };
  });
  const before = storedPlan(review?.plan);
  const plan = isToday ? await resolvePlan(user.id, v.date, v.plan, items, before) : before;
  const fields: ReviewFields = { items, plan, wins: v.wins, problems: v.problems, improvement: v.improvement, lastImprovement: v.lastImprovement, energy: v.energy, focusLevel: v.focusLevel };
  const text = { wins: v.wins, problems: v.problems, improvement: v.improvement, lastImprovement: v.lastImprovement, energy: v.energy, focusLevel: v.focusLevel };
  const where = { userId_date: { userId: user.id, date: v.date } };

  if (!v.submit && !submitted) {
    const data = { status: 'DRAFT', items: json(items), plan: json(plan), ...countOutcomes(items), ...text };
    await db.dailyReview.upsert({ where, create: { userId: user.id, date: v.date, ...data }, update: data });
    return { date: v.date, status: 'DRAFT', changes: 0 };
  }
  const changes = submitted ? reviewChanges(fieldsOf(review), fields) : [];
  if (submitted && !changes.length) return { date: v.date, status: 'SUBMITTED', changes: 0 };
  const metrics = review?.metrics ?? await dayMetrics(v.date, tz);
  await retryTransaction(() => db.$transaction(async tx => {
    const finalPlan = isToday ? await applyToday(tx, user.id, v.date, items, plan, before, now) : plan;
    const data = { status: 'SUBMITTED', items: json(items), plan: json(finalPlan), ...countOutcomes(items), ...text, metrics: json(metrics), submittedAt: review?.submittedAt ?? now };
    const row = await tx.dailyReview.upsert({ where, create: { userId: user.id, date: v.date, ...data }, update: data });
    await tx.dailyReviewRevision.create({ data: { reviewId: row.id, kind: submitted ? 'EDIT' : 'SUBMIT', changes: json(changes), createdAt: now } });
  }));
  return { date: v.date, status: 'SUBMITTED', changes: changes.length };
}

/** A day off (rest days are irregular): no review, no reminder, not counted in the completion rate, the streak goes on. */
export async function markRest(user: Actor, input: unknown, now = new Date()) {
  requireAdmin(user, ADMIN_ONLY);
  const { date } = z.object({ date: DATE }).parse(input);
  const { today } = await settings(now);
  checkDate(date, today);
  const review = await db.dailyReview.findUnique({ where: { userId_date: { userId: user.id, date } } });
  if (review?.status === 'SUBMITTED') throw new HttpError(409, '这一天已经复盘，不能再标为休息');
  if (review?.status === 'REST') return { date, status: 'REST' };
  await db.$transaction(async tx => {
    const data = { status: 'REST', items: json([]), done: 0, planned: 0, carried: 0, dropped: 0 };
    const row = await tx.dailyReview.upsert({ where: { userId_date: { userId: user.id, date } }, create: { userId: user.id, date, plan: json([]), ...data }, update: data });
    await tx.dailyReviewRevision.create({ data: { reviewId: row.id, kind: 'REST', changes: json([]), createdAt: now } });
  });
  return { date, status: 'REST' };
}

// ───────────────────────── The record ─────────────────────────

export const historyQuery = z.object({ month: MONTH.optional(), q: z.string().trim().max(50, '搜索词不能超过 50 字').optional() });
const previousMonth = (month: string) => addDays(`${month}-01`, -1).slice(0, 7);
const lastDayOf = (month: string) => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 复盘记录 of one person: a month at a glance (three things done each day, days not reviewed), the streak and the
 * month against the one before, why things were not done, whether each improvement was kept, how the month focus
 * moved, where the energy went, and every day's review with tomorrow's plan and every change made after submitting.
 */
export async function reviewHistory(user: Actor, input: unknown = {}, now = new Date()) {
  requireAdmin(user, ADMIN_ONLY);
  const query = historyQuery.parse(input);
  const { tz, config, today } = await settings(now);
  const month = query.month ?? monthOf(today);
  const grid = monthGrid(month), first = `${month}-01`, last = lastDayOf(month), prev = previousMonth(month);
  const [all, rows, prevRows, todayThree, focus, done] = await Promise.all([
    db.dailyReview.findMany({ where: { userId: user.id }, select: { date: true, status: true, improvement: true, lastImprovement: true }, orderBy: { date: 'asc' } }),
    db.dailyReview.findMany({ where: { userId: user.id, date: { gte: grid[0], lte: grid[grid.length - 1] } }, include: { revisions: { orderBy: { createdAt: 'asc' } } }, orderBy: { date: 'desc' } }),
    db.dailyReview.findMany({ where: { userId: user.id, date: { gte: `${prev}-01`, lt: first } }, select: { status: true, done: true, planned: true, carried: true } }),
    db.workItem.findMany({ where: { userId: user.id, date: today, topOrder: { not: null }, status: { not: 'DROPPED' }, kind: { in: THREE_KINDS } }, select: { status: true } }),
    focusGoals(month, mondayOf(first)),
    db.workItem.groupBy({ by: ['category'], where: { userId: user.id, status: 'DONE', doneAt: { gte: localStart(first, tz), lt: localStart(addDays(last, 1), tz) } }, _count: { _all: true } }),
  ]);
  const inMonth = rows.filter(r => r.date >= first && r.date <= last && r.date <= today);
  const rowOf = new Map(rows.map(r => [r.date, r]));
  const days = grid.map(key => {
    const row = rowOf.get(key);
    const open = key === today && row?.status !== 'SUBMITTED' && row?.status !== 'REST';
    return { key, inMonth: monthOf(key) === month, today: key === today, future: key > today,
      status: open ? 'OPEN' : row && (row.status !== 'DRAFT' || key === today) ? row.status : 'NONE',
      done: open ? todayThree.filter(i => i.status === 'DONE').length : row?.done ?? 0, planned: open ? todayThree.length : row?.planned ?? 0 };
  });

  const rate = completion(inMonth), prevRate = completion(prevRows);
  const perDay = (list: { status: string; carried: number }[]) => {
    const counted = list.filter(r => r.status === 'SUBMITTED' || r.status === 'MISSED');
    return counted.length ? round1(counted.reduce((sum, r) => sum + r.carried, 0) / counted.length) : null;
  };
  const checked = inMonth.filter(r => r.lastImprovement);

  // Why things were not done this month, most frequent first.
  const reasons = new Map<Reason, number>();
  for (const row of inMonth) for (const item of storedItems(row.items)) if (item.outcome !== 'DONE' && item.reason) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  const reasonRows = [...reasons].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: REASONS[key].label, count, advice: REASONS[key].advice }));

  // Each improvement written, and whether the next review said it was kept.
  const submittedAll = all.filter(r => r.status === 'SUBMITTED');
  const improvements = submittedAll.filter(r => r.improvement && r.date >= first && r.date <= last).reverse().slice(0, 8).map(r => {
    const next = submittedAll.find(n => n.date > r.date);
    return { date: r.date, text: r.improvement, result: next?.lastImprovement ?? null };
  });

  const logs = await db.focusProgressLog.findMany({ where: { focusId: { in: focus.months.map(m => m.id) } }, orderBy: { createdAt: 'asc' }, include: { focus: { select: { title: true, unit: true } } } });
  const progress = focus.months.map(m => {
    const points = new Map<string, number>();
    for (const log of logs.filter(l => l.focusId === m.id)) points.set(log.date, log.toValue);
    return { id: m.id, title: m.title, targetValue: m.targetValue, currentValue: m.currentValue, unit: m.unit, progress: m.progress, points: [...points].map(([date, value]) => ({ date, value })) };
  });

  const energy = { CONVERT: 0, FRONTEND: 0, DATA: 0 } as Record<Category, number>;
  for (const row of done) if (row.category in energy) energy[row.category as Category] = row._count._all;

  // The journal: the month's days (or what a search found), newest first.
  const journalRows = query.q
    ? await db.dailyReview.findMany({ where: { userId: user.id, OR: [{ wins: { contains: query.q } }, { problems: { contains: query.q } }, { improvement: { contains: query.q } }] },
      include: { revisions: { orderBy: { createdAt: 'asc' } } }, orderBy: { date: 'desc' }, take: 30 })
    : rows.filter(r => r.date >= first && r.date <= last && (r.status !== 'DRAFT' || r.date === today));
  const ownLogs = await db.focusProgressLog.findMany({ where: { userId: user.id, date: { in: journalRows.map(r => r.date) } }, orderBy: { createdAt: 'asc' }, include: { focus: { select: { title: true, unit: true } } } });
  const journal = journalRows.map(r => {
    const previous = submittedAll.filter(p => p.date < r.date && p.improvement).at(-1);
    return {
      date: r.date, status: r.status, items: storedItems(r.items), done: r.done, planned: r.planned, carried: r.carried, dropped: r.dropped,
      wins: r.wins, problems: r.problems, improvement: r.improvement, lastImprovement: r.lastImprovement, previousImprovement: previous?.improvement ?? '',
      energy: r.energy, focusLevel: r.focusLevel, plan: storedPlan(r.plan), metrics: r.metrics as DayMetrics | null,
      submittedAt: r.submittedAt?.toISOString() ?? null, late: !!r.submittedAt && formatInTimeZone(r.submittedAt, tz, 'yyyy-MM-dd') > r.date,
      revisions: r.revisions.map(x => ({ kind: x.kind, createdAt: x.createdAt.toISOString(), changes: x.changes })),
      focusChanges: ownLogs.filter(l => l.date === r.date).map(l => ({ title: l.focus.title, unit: l.focus.unit, from: l.fromValue, to: l.toValue, target: l.target })),
    };
  });

  return {
    month, today, timezone: tz, q: query.q ?? '', prevMonth: prev, nextMonth: monthOf(addDays(last, 1)),
    days,
    stats: {
      streak: reviewStreak(all, today),
      rate: rate.rate, prevRate: prevRate.rate, reviewed: inMonth.filter(r => r.status === 'SUBMITTED').length,
      carriedPerDay: perDay(inMonth), prevCarriedPerDay: perDay(prevRows),
      improvement: { total: checked.length, yes: checked.filter(r => r.lastImprovement === 'YES').length, partly: checked.filter(r => r.lastImprovement === 'PARTLY').length },
    },
    reasons: reasonRows, improvements, progress, energy: energyView(energy, config),
    journal,
  };
}
export type HistoryData = Awaited<ReturnType<typeof reviewHistory>>;

// ───────────────────────── The 21:30 reminder ─────────────────────────

/**
 * 21:30 every day, weekends included: a push to review the day, to every administrator who used the workbench in the
 * last two weeks and has neither reviewed today nor marked it as rest. Once per person per day: today's review row
 * records that it went out. Runs from the 5-minute job and while the CRM is open, so it arrives within minutes.
 */
export async function deliverReviewReminders(now = new Date()) {
  const { tz, today } = await settings(now);
  const [hour, minute] = formatInTimeZone(now, tz, 'HH:mm').split(':').map(Number);
  if (hour * 60 + minute < REVIEW_REMINDER.hour * 60 + REVIEW_REMINDER.minute) return { reminded: 0, pushed: 0 };
  const since = addDays(today, -14);
  const ids = (await db.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })).map(u => u.id);
  if (!ids.length) return { reminded: 0, pushed: 0 };
  const [used, reviews] = await Promise.all([
    db.workItem.groupBy({ by: ['userId'], where: { userId: { in: ids }, date: { gte: since, lte: today }, kind: { in: THREE_KINDS } } }),
    db.dailyReview.findMany({ where: { userId: { in: ids }, date: { gte: since, lte: today } }, select: { userId: true, date: true, status: true } }),
  ]);
  let reminded = 0, pushed = 0;
  for (const userId of new Set([...used.map(u => u.userId), ...reviews.map(r => r.userId)])) {
    const own = reviews.find(r => r.userId === userId && r.date === today);
    if (own && own.status !== 'DRAFT') continue;
    if (!own) await db.dailyReview.create({ data: { userId, date: today, items: json([]), plan: json([]) } }).catch(ignoreDuplicate);
    const claimed = await db.dailyReview.updateMany({ where: { userId, date: today, status: 'DRAFT', remindedAt: null }, data: { remindedAt: now } });
    if (!claimed.count) continue;
    reminded++;
    const three = await db.workItem.findMany({ where: { userId, date: today, topOrder: { not: null }, status: { not: 'DROPPED' }, kind: { in: THREE_KINDS } }, select: { status: true } });
    const doneCount = three.filter(i => i.status === 'DONE').length;
    pushed += (await sendPush([userId], { title: `该复盘了 · ${Number(today.slice(5, 7))}月${Number(today.slice(8, 10))}日`,
      body: `${three.length ? `今天三件事完成 ${doneCount}/${three.length}。` : ''}花 3 分钟回顾今天，排好明天的三件事。`,
      href: '/workbench/review', tag: `review:${today}`, urgent: false }, 3 * 3600)).sent;
  }
  return { reminded, pushed };
}
