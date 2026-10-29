import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { dayKey } from '@/lib/time';
import { TERMINAL_STAGES } from '@/lib/constants';
import { CATEGORIES, DAY, HOUR, categoryEnum, focusSignals, readConfig, type Category, type OutreachConfig, type SignalInput } from '@/lib/outreach';
import {
  KIND_RANK, PRESET_EVENTS, PRESET_MONTHS, PRESET_TIME_BLOCKS, PRESET_WEEKS, addDays, completion, countOutcomes, daysBetween, fixedItemsFor, mondayOf, monthOf, rankToday,
  reviewStreak, weekday, type ReviewItem,
} from '@/lib/workbench';
import { nonStandardShares } from './outreach-analytics-service';
import { currentCustomers } from '@/lib/customer-group';

/**
 * 工作台 for the operations lead (docs/OUTREACH_AND_WORKBENCH.md): the month focus (3 at most), the week focus (3 at
 * most, each tied to a month focus) and today's three things, planned the night before in the daily review
 * (services/daily-review-service.ts) or picked in order when the day starts. Focus goals are shared by the company;
 * items, time blocks and reviews belong to each administrator. Reading never writes: the page asks POST /plan to lay
 * out the day (record the days nobody reviewed, carry over what was not done, fixed items, time blocks, fix today's
 * three) and the live items (urgent customers, focus signals) are computed on every read, so they disappear as soon
 * as their condition is gone.
 */
export const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 yyyy-MM-dd');
export const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm');
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份格式应为 yyyy-MM');
const PRESET_MARKER = 'workbench-presets:2026Q4';

export async function settings(now: Date) {
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, outreachConfig: true } });
  return { tz: setting.timezone, config: readConfig(setting.outreachConfig), today: dayKey(now, setting.timezone) };
}
export const localStart = (key: string, tz: string) => fromZonedTime(`${key}T00:00:00`, tz);
export const ignoreDuplicate = (error: unknown) => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; };

// ───────────────────────── Reading ─────────────────────────

/** Kinds that can be one of the day's three things (urgent items, signals, time blocks and events cannot). */
export const THREE_KINDS = ['MANUAL', 'FOCUS', 'FIXED'];

const itemSelect = { id: true, date: true, endDate: true, title: true, detail: true, kind: true, category: true, focusId: true, startTime: true, endTime: true, pin: true,
  topOrder: true, status: true, doneAt: true, carryCount: true, originalDate: true, sourceKey: true, href: true, createdAt: true, focus: { select: { title: true } } } satisfies Prisma.WorkItemSelect;
type ItemRow = Prisma.WorkItemGetPayload<{ select: typeof itemSelect }>;
export type CalendarItem = Omit<ItemRow, 'focus' | 'doneAt' | 'createdAt'> & { focusTitle: string; live: boolean; tone: '' | 'danger' | 'warning'; createdAt: string; doneAt: string | null };
const toItem = (row: ItemRow): CalendarItem => ({ ...row, focusTitle: row.focus?.title ?? '', live: false, tone: row.carryCount > 0 ? 'warning' : '', createdAt: row.createdAt.toISOString(),
  doneAt: row.doneAt?.toISOString() ?? null });
const liveItem = (id: string, kind: 'URGENT' | 'SIGNAL', title: string, detail: string, href: string, category: Category, tone: CalendarItem['tone']): CalendarItem =>
  ({ id, kind, title, detail, href, category, tone, live: true, date: '', endDate: null, focusId: null, focusTitle: '', startTime: null, endTime: null, pin: 0, topOrder: null,
    status: 'TODO', doneAt: null, carryCount: 0, originalDate: null, sourceKey: null, createdAt: '' });

export async function focusGoals(month: string, week: string) {
  const [months, weeks] = await Promise.all([
    db.focusGoal.findMany({ where: { level: 'MONTH', periodKey: month }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
    db.focusGoal.findMany({ where: { level: 'WEEK', periodKey: week }, include: { parent: { select: { title: true } } }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  return { months, weeks: weeks.map(({ parent, ...w }) => ({ ...w, parentTitle: parent?.title ?? '' })) };
}

/**
 * The urgent items, live: new leads not answered within 5 minutes (first-contact deadline passed, or waiting in the
 * pool), and A-grade or high-intent customers whose message has waited over 2 hours.
 */
export async function urgentItems(now: Date, config: OutreachConfig): Promise<CalendarItem[]> {
  const active = { deletedAt: null, stage: { notIn: [...TERMINAL_STAGES] } } satisfies Prisma.CustomerWhereInput;
  const uncontacted = { firstContactAt: null, contactedAt: null, lastOutboundAt: null, lastFollowUpAt: null } satisfies Prisma.CustomerWhereInput;
  const late = new Date(now.getTime() - config.firstReplyMinutes * 60_000), week = new Date(now.getTime() - 7 * DAY);
  // 新客户 only: 旧客户 are worked from their own page (lib/customer-group).
  const leadWhere: Prisma.CustomerWhereInput = { ...active, ...uncontacted, OR: [{ firstContactDueAt: { lt: now } }, { pendingAssignment: true, createdAt: { lt: late, gte: week } }], AND: [currentCustomers] };
  const waiting = new Date(now.getTime() - config.hotReplyHours * HOUR);
  const hotWhere: Prisma.CustomerWhereInput = { ...active, lastInboundAt: { lt: waiting, gte: new Date(now.getTime() - 14 * DAY) }, OR: [{ leadGrade: 'A' }, { bestReplyQuality: 'HIGH' }],
    AND: [currentCustomers, { OR: [{ lastOutboundAt: null }, { lastInboundAt: { gt: db.customer.fields.lastOutboundAt } }] }, { OR: [{ lastFollowUpAt: null }, { lastInboundAt: { gt: db.customer.fields.lastFollowUpAt } }] }] };
  const [leads, leadCount, hot, hotCount] = await Promise.all([
    db.customer.findMany({ where: leadWhere, select: { name: true }, orderBy: { createdAt: 'asc' }, take: 5 }), db.customer.count({ where: leadWhere }),
    db.customer.findMany({ where: hotWhere, select: { name: true }, orderBy: { lastInboundAt: 'asc' }, take: 5 }), db.customer.count({ where: hotWhere }),
  ]);
  const list = (rows: { name: string }[], total: number) => rows.map(r => r.name).join('、') + (total > rows.length ? ` 等 ${total} 位` : '');
  const items: CalendarItem[] = [];
  if (leadCount) items.push(liveItem('urgent:first-reply', 'URGENT', `${leadCount} 条新线索超过 ${config.firstReplyMinutes} 分钟未首回`, list(leads, leadCount), '/messages?filter=pending', 'CONVERT', 'danger'));
  if (hotCount) items.push(liveItem('urgent:hot-reply', 'URGENT', `${hotCount} 位 A 类 / 高意向客户的回复超过 ${config.hotReplyHours} 小时未处理`, list(hot, hotCount), '/messages?filter=awaiting', 'CONVERT', 'danger'));
  return items;
}

const FORM_SOURCES = ['FACEBOOK', 'INSTAGRAM', 'META_CLICK_TO_WHATSAPP'];
/** Everything the focus signals compare, as of `now`, so a past day can be replayed. */
export async function signalInput(userId: string, now: Date, tz: string, config: OutreachConfig): Promise<SignalInput> {
  const matureEnd = now.getTime() - DAY;
  const window = (end: number) => ({ start: end - 7 * DAY, end });
  const windows = [0, 1, 2, 3, 4].map(i => window(matureEnd - i * 7 * DAY));
  const touches = await db.outreachTouch.findMany({ where: { code: 'T0', judgeStatus: { not: 'VOID' }, replied24h: { not: null }, customer: { AND: [{ deletedAt: null }, currentCustomers] },
    sentAt: { gte: new Date(windows[4].start), lt: new Date(matureEnd) } }, select: { sentAt: true, replied24h: true } });
  const rate = (w: { start: number; end: number }) => {
    const rows = touches.filter(t => t.sentAt.getTime() >= w.start && t.sentAt.getTime() < w.end);
    return { sent: rows.length, replied: rows.filter(t => t.replied24h).length };
  };
  const leadWindows = [0, 1, 2, 3, 4].map(i => window(now.getTime() - i * 7 * DAY));
  const leads = await db.customer.findMany({ where: { deletedAt: null, leadGrade: { in: ['A', 'B', 'C'] }, submissions: { some: {} },
    OR: [{ inquiryAt: { gte: new Date(leadWindows[4].start), lt: now } }, { inquiryAt: null, createdAt: { gte: new Date(leadWindows[4].start), lt: now } }] },
    select: { leadGrade: true, inquiryAt: true, createdAt: true } });
  const share = (w: { start: number; end: number }) => {
    const rows = leads.filter(l => { const at = (l.inquiryAt ?? l.createdAt).getTime(); return at >= w.start && at < w.end; });
    return { total: rows.length, business: rows.filter(l => l.leadGrade === 'A' || l.leadGrade === 'B').length };
  };
  const hot = await db.customer.findMany({ where: { deletedAt: null, stage: { notIn: [...TERMINAL_STAGES] },
    outreachReplies: { some: { quality: 'HIGH', receivedAt: { lt: new Date(now.getTime() - config.hotBacklogHours * HOUR), gte: new Date(now.getTime() - 30 * DAY) } } } },
    select: { quotedAt: true, outreachReplies: { where: { quality: 'HIGH', receivedAt: { lt: new Date(now.getTime() - config.hotBacklogHours * HOUR) } }, orderBy: { receivedAt: 'asc' }, take: 1, select: { receivedAt: true } } } });
  const staleQuotes = await db.customer.count({ where: { deletedAt: null, stage: 'QUOTED',
    quotedAt: { lte: new Date(now.getTime() - config.staleQuoteDays * DAY), gte: new Date(now.getTime() - 30 * DAY) },
    OR: [{ lastInboundAt: null }, { lastInboundAt: { lte: db.customer.fields.quotedAt } }] } });
  const todayStart = localStart(dayKey(now, tz), tz);
  const fresh = await db.customer.findMany({ where: { deletedAt: null, createdAt: { gte: todayStart, lt: now }, OR: [{ source: { in: FORM_SOURCES } }, { submissions: { some: {} } }] },
    select: { createdAt: true, firstContactAt: true, contactedAt: true, lastOutboundAt: true } });
  const slow = fresh.filter(c => {
    const first = [c.firstContactAt, c.contactedAt, c.lastOutboundAt].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    return ((first ?? now).getTime() - c.createdAt.getTime()) > config.firstReplyMinutes * 60_000;
  }).length;
  const week = mondayOf(dayKey(now, tz));
  const done = await db.workItem.groupBy({ by: ['category'], where: { userId, status: 'DONE', doneAt: { gte: localStart(week, tz), lt: localStart(addDays(week, 7), tz) } }, _count: { _all: true } });
  const energy = { CONVERT: 0, FRONTEND: 0, DATA: 0 } as Record<Category, number>;
  for (const row of done) if (row.category in energy) energy[row.category as Category] = row._count._all;
  return {
    t0Current: rate(windows[0]), t0Previous: windows.slice(1).map(rate),
    leadsCurrent: share(leadWindows[0]), leadsPrevious: leadWindows.slice(1).map(share),
    hotBacklog: hot.filter(c => { const first = c.outreachReplies[0]?.receivedAt; return first && (!c.quotedAt || c.quotedAt < first); }).length,
    staleQuotes, slowFirstReplies: slow,
    nonStandard: (await nonStandardShares(new Date(now.getTime() - 7 * DAY), now)).map(p => ({ name: p.name, share: p.share, total: p.total })),
    energy,
  };
}

/** The open tasks of the whole team due today, per person (shown folded under 其他事项). */
async function teamTasks(now: Date, tz: string, today: string) {
  const end = localStart(addDays(today, 1), tz);
  const tasks = await db.task.findMany({ where: { deletedAt: null, status: { not: 'DONE' }, dueDate: { lt: end } }, take: 2000,
    select: { dueDate: true, assigneeId: true, createdBy: true, customer: { select: { ownerId: true } } } });
  const users = await db.user.findMany({ select: { id: true, name: true } });
  const names = new Map(users.map(u => [u.id, u.name]));
  const per = new Map<string, { name: string; due: number; overdue: number }>();
  for (const t of tasks) {
    const id = t.customer?.ownerId ?? t.assigneeId ?? t.createdBy;
    const entry = per.get(id) ?? { name: names.get(id) ?? '未分配', due: 0, overdue: 0 };
    entry.due++; if (t.dueDate < now) entry.overdue++;
    per.set(id, entry);
  }
  return [...per.values()].sort((a, b) => b.overdue - a.overdue || b.due - a.due);
}

export function energyView(energy: Record<Category, number>, config: OutreachConfig) {
  const total = energy.CONVERT + energy.FRONTEND + energy.DATA;
  return { total, minItems: config.energyMinItems, deviation: config.energyDeviationPoints,
    rows: (Object.keys(CATEGORIES) as Category[]).map(key => ({ key, label: CATEGORIES[key], done: energy[key], share: total ? Math.round(energy[key] / total * 100) : null, target: config.energyTargets[key] })) };
}


const byPlace = (a: CalendarItem, b: CalendarItem) => (a.topOrder ?? 9) - (b.topOrder ?? 9);
const byRank = (a: CalendarItem, b: CalendarItem) => Number(a.status === 'DONE') - Number(b.status === 'DONE') || (KIND_RANK[a.kind] ?? 8) - (KIND_RANK[b.kind] ?? 8)
  || b.carryCount - a.carryCount || a.createdAt.localeCompare(b.createdAt);

/**
 * 今天: the focus, today's three things (fixed for the day: what is done stays, ticked), urgent customers and focus
 * signals (live), the time blocks, the rest folded away, and how the reviews are going.
 */
export async function workbench(user: Actor, now = new Date()) {
  requireAdmin(user, '工作日历仅管理员可用');
  const { tz, config, today } = await settings(now);
  const month = monthOf(today), week = mondayOf(today), tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
  const [focus, rows, facts, urgent, team, reviews, latest] = await Promise.all([
    focusGoals(month, week),
    db.workItem.findMany({ where: { userId: user.id, status: { not: 'DROPPED' },
      OR: [{ date: today }, { date: tomorrow, topOrder: { not: null } }, { kind: 'EVENT', date: { lte: today }, endDate: { gte: today } }] }, select: itemSelect }),
    signalInput(user.id, now, tz, config),
    urgentItems(now, config),
    teamTasks(now, tz, today),
    db.dailyReview.findMany({ where: { userId: user.id, date: { lte: today } }, select: { date: true, status: true, done: true, planned: true, submittedAt: true }, orderBy: { date: 'asc' } }),
    db.dailyReview.findFirst({ where: { userId: user.id, date: { lt: today }, status: 'SUBMITTED' }, orderBy: { date: 'desc' }, select: { date: true, improvement: true, submittedAt: true } }),
  ]);
  const items = rows.map(toItem);
  const todays = items.filter(i => i.date === today && i.kind !== 'EVENT');
  const three = todays.filter(i => i.topOrder !== null && THREE_KINDS.includes(i.kind)).sort(byPlace);
  const own = reviews.find(r => r.date === today), last = reviews.find(r => r.date === yesterday);
  return {
    today, tomorrow, timezone: tz, clock: formatInTimeZone(now, tz, 'HH:mm'), month, week, focus,
    three,
    // When last night's review placed today's three things.
    plannedAt: three.length && latest?.date === yesterday ? latest.submittedAt?.toISOString() ?? null : null,
    others: todays.filter(i => !three.includes(i) && i.kind !== 'TIMEBLOCK').sort(byRank),
    timeBlocks: todays.filter(i => i.kind === 'TIMEBLOCK').sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))),
    events: items.filter(i => i.kind === 'EVENT'),
    urgent, signals: focusSignals(facts, config), teamTasks: team,
    review: { status: own?.status ?? 'NONE', submittedAt: own?.submittedAt?.toISOString() ?? null },
    tomorrowPlan: own?.status === 'SUBMITTED' ? items.filter(i => i.date === tomorrow).sort(byPlace) : [],
    lastImprovement: latest?.improvement ? { date: latest.date, text: latest.improvement } : null,
    stats: {
      yesterday: last && (last.status === 'SUBMITTED' || last.status === 'MISSED') ? { done: last.done, planned: last.planned } : null,
      restedYesterday: last?.status === 'REST',
      streak: reviewStreak(reviews, today).current,
      // Finished days of this week, and today once reviewed.
      weekRate: completion(reviews.filter(r => r.date >= week && (r.date < today || r.status === 'SUBMITTED'))).rate,
    },
  };
}
export type WorkbenchData = Awaited<ReturnType<typeof workbench>>;

// ───────────────────────── Planning the day ─────────────────────────

/** Q4 2026 focus goals (once for the company), the user's time blocks (once) and the Canton Fair dates. */
async function ensurePresets(userId: string) {
  try {
    await db.$transaction(async tx => {
      await tx.dailyAdInsight.create({ data: { reportKey: PRESET_MARKER, reportDate: new Date(), timezone: 'UTC', evidence: {}, analysis: {}, model: 'marker' } });
      const parents = new Map<string, string>();
      for (const [month, goals] of Object.entries(PRESET_MONTHS)) {
        for (const [sort, goal] of goals.entries()) {
          const row = await tx.focusGoal.create({ data: { level: 'MONTH', periodKey: month, title: goal.title, target: goal.target, category: goal.category, sort, createdBy: 'PRESET' } });
          parents.set(goal.key, row.id);
        }
      }
      for (const [week, goals] of Object.entries(PRESET_WEEKS)) {
        for (const [sort, goal] of goals.entries()) await tx.focusGoal.create({ data: { level: 'WEEK', periodKey: week, title: goal.title, category: goal.category, sort,
          parentId: parents.get(goal.parent) ?? null, createdBy: 'PRESET' } });
      }
    });
  } catch (error) {
    // The marker exists: another run (or an earlier day) already laid them out, and edits since then are kept.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
  }
  if (!await db.timeBlock.count({ where: { userId } })) {
    await db.timeBlock.createMany({ data: PRESET_TIME_BLOCKS.map((block, sort) => ({ userId, ...block, weekdays: '1,2,3,4,5', sort })) });
  }
  for (const event of PRESET_EVENTS) {
    await db.workItem.upsert({ where: { userId_date_sourceKey: { userId, date: event.date, sourceKey: event.sourceKey } }, update: {},
      create: { userId, kind: 'EVENT', date: event.date, endDate: event.endDate, title: event.title, detail: event.detail, category: event.category, sourceKey: event.sourceKey } });
  }
}


export const snapshotSelect = { id: true, date: true, title: true, category: true, carryCount: true, status: true, topOrder: true, focus: { select: { title: true } } } satisfies Prisma.WorkItemSelect;
/** A day's three things as they stand: done, dropped, or (still open) carried on. */
export const snapshotOf = (rows: Prisma.WorkItemGetPayload<{ select: typeof snapshotSelect }>[]): ReviewItem[] =>
  [...rows].sort((a, b) => (a.topOrder ?? 9) - (b.topOrder ?? 9)).map(i => ({ itemId: i.id, title: i.title, category: i.category, focusTitle: i.focus?.title ?? '',
    carryCount: i.carryCount, outcome: i.status === 'DONE' ? 'DONE' : i.status === 'DROPPED' ? 'DROPPED' : 'CARRIED', reason: null, note: '' }));

/**
 * The days before today nobody reviewed (in the last two weeks): their three things are recorded as they stand, so
 * the record shows what was planned and done even without a review, and a draft left unsubmitted is closed. Runs
 * before carrying over, while the open items are still on their own day.
 */
async function recordPastDays(userId: string, today: string) {
  const from = addDays(today, -14);
  const [rows, reviews] = await Promise.all([
    db.workItem.findMany({ where: { userId, date: { gte: from, lt: today }, topOrder: { not: null }, kind: { in: THREE_KINDS } }, select: snapshotSelect }),
    db.dailyReview.findMany({ where: { userId, date: { gte: from, lt: today } }, select: { id: true, date: true, status: true } }),
  ]);
  let recorded = 0;
  for (const date of [...new Set([...rows.map(r => r.date), ...reviews.filter(r => r.status === 'DRAFT').map(r => r.date)])]) {
    const review = reviews.find(r => r.date === date);
    if (review && review.status !== 'DRAFT') continue;
    const items = snapshotOf(rows.filter(r => r.date === date));
    const data = { status: 'MISSED', items, ...countOutcomes(items) };
    if (review) recorded += (await db.dailyReview.updateMany({ where: { id: review.id, status: 'DRAFT' }, data })).count;
    else recorded += await db.dailyReview.create({ data: { userId, date, plan: [], ...data } }).then(() => 1, error => { ignoreDuplicate(error); return 0; });
  }
  return recorded;
}

/** Today's three things are fixed when the day starts, in order, unless last night's review already placed them. */
async function placeThree(userId: string, today: string) {
  const items = await db.workItem.findMany({ where: { userId, date: today, status: { not: 'DROPPED' }, kind: { in: THREE_KINDS } } });
  if (items.some(i => i.topOrder !== null)) return 0;
  const { top } = rankToday(items);
  for (const [index, item] of top.entries()) await db.workItem.updateMany({ where: { id: item.id, topOrder: null }, data: { topOrder: index + 1 } });
  return top.length;
}

/**
 * Lays out today, idempotently: presets on the first day, a record of the days nobody reviewed, today's fixed items
 * and time blocks, every item not done on an earlier day moved to today with its carry count raised by the days it
 * waited, and today's three things.
 */
export async function planDay(user: Actor, now = new Date()) {
  requireAdmin(user, '工作日历仅管理员可用');
  const { today } = await settings(now);
  await ensurePresets(user.id);
  const recorded = await recordPastDays(user.id, today);
  const upsert = (sourceKey: string, data: Omit<Prisma.WorkItemUncheckedCreateInput, 'userId' | 'date' | 'sourceKey'>) =>
    db.workItem.upsert({ where: { userId_date_sourceKey: { userId: user.id, date: today, sourceKey } }, update: {}, create: { userId: user.id, date: today, sourceKey, ...data } });
  const fixed = fixedItemsFor(today);
  for (const item of fixed) await upsert(item.sourceKey, { kind: 'FIXED', title: item.title, detail: item.detail, category: item.category, href: item.href });
  const blocks = (await db.timeBlock.findMany({ where: { userId: user.id, active: true }, orderBy: [{ startTime: 'asc' }, { sort: 'asc' }] }))
    .filter(b => b.weekdays.split(',').map(Number).includes(weekday(today)));
  for (const block of blocks) await upsert(`timeblock:${block.id}`, { kind: 'TIMEBLOCK', title: block.title, category: block.category, startTime: block.startTime, endTime: block.endTime });
  const stale = await db.workItem.findMany({ where: { userId: user.id, status: 'TODO', date: { lt: today }, kind: { in: THREE_KINDS } } });
  let carried = 0;
  for (const item of stale) {
    try {
      // Carried in without a review, it waits to be picked again: today's three are chosen below.
      await db.workItem.updateMany({ where: { id: item.id, status: 'TODO', date: item.date },
        data: { date: today, carryCount: item.carryCount + daysBetween(item.date, today), originalDate: item.originalDate ?? item.date, topOrder: null } });
      carried++;
    } catch (error) {
      ignoreDuplicate(error);
    }
  }
  return { date: today, fixed: fixed.length, timeBlocks: blocks.length, carried, recorded, placed: await placeThree(user.id, today) };
}

// ───────────────────────── Editing ─────────────────────────

const itemInput = z.object({
  date: DATE, endDate: DATE.nullable().default(null),
  title: z.string().trim().min(1, '请填写事项').max(200, '事项不能超过 200 字'),
  detail: z.string().trim().max(1000).default(''),
  category: categoryEnum.default('CONVERT'),
  kind: z.enum(['MANUAL', 'EVENT']).default('MANUAL'),
  focusId: z.string().trim().max(191).nullable().default(null),
  startTime: TIME.nullable().default(null), endTime: TIME.nullable().default(null),
  // 1: one of that day's three things
  pin: z.coerce.number().int().min(-1).max(1).default(0),
}).superRefine((v, ctx) => { if (v.endDate && v.endDate < v.date) ctx.addIssue({ code: 'custom', path: ['endDate'], message: '结束日期不能早于开始日期' }); });
const itemPatch = z.object({
  date: DATE.optional(), endDate: DATE.nullable().optional(), title: z.string().trim().min(1, '请填写事项').max(200).optional(), detail: z.string().trim().max(1000).optional(),
  category: categoryEnum.optional(), focusId: z.string().trim().max(191).nullable().optional(), pin: z.coerce.number().int().min(-1).max(1).optional(),
  status: z.enum(['TODO', 'DONE']).optional(), startTime: TIME.nullable().optional(), endTime: TIME.nullable().optional(),
});

export async function weekFocus(focusId: string | null | undefined) {
  if (!focusId) return null;
  const focus = await db.focusGoal.findUnique({ where: { id: focusId } });
  if (!focus || focus.level !== 'WEEK') throw new HttpError(400, '只能挂在本周重心下');
  return focus;
}

/** The first free place among a day's three things. */
export async function freePlace(userId: string, date: string) {
  const taken = (await db.workItem.findMany({ where: { userId, date, topOrder: { not: null }, status: { not: 'DROPPED' } }, select: { topOrder: true } })).map(i => i.topOrder);
  const place = [1, 2, 3].find(n => !taken.includes(n));
  if (!place) throw new HttpError(409, '三件事已经排满，先移出一件');
  return place;
}

export async function createItem(input: unknown, user: Actor) {
  requireAdmin(user, '工作日历仅管理员可用');
  const v = itemInput.parse(input);
  const focus = await weekFocus(v.focusId);
  const topOrder = v.pin === 1 && v.kind !== 'EVENT' ? await freePlace(user.id, v.date) : null;
  return db.workItem.create({ data: { ...v, userId: user.id, topOrder, kind: v.kind === 'EVENT' ? 'EVENT' : focus ? 'FOCUS' : 'MANUAL', category: focus ? focus.category : v.category,
    endDate: v.kind === 'EVENT' ? v.endDate ?? v.date : null }, select: { id: true } });
}

async function ownItem(id: string, user: Actor) {
  z.string().trim().min(1).max(191).parse(id);
  const item = await db.workItem.findFirst({ where: { id, userId: user.id } });
  if (!item) throw new HttpError(404, '事项不存在');
  return item;
}

/** pin 1 puts an item into its day's three things (409 when full), pin -1 takes it out; moving it to another day takes it out too. */
export async function updateItem(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '工作日历仅管理员可用');
  const v = itemPatch.parse(input);
  const item = await ownItem(id, user);
  const focus = v.focusId !== undefined ? await weekFocus(v.focusId) : undefined;
  let topOrder = v.date && v.date !== item.date ? null : item.topOrder;
  if (v.pin === -1) topOrder = null;
  if (v.pin === 1 && topOrder === null && THREE_KINDS.includes(item.kind)) topOrder = await freePlace(user.id, v.date ?? item.date);
  await db.workItem.update({ where: { id: item.id }, data: { ...v, topOrder,
    ...(focus !== undefined && item.kind !== 'EVENT' && item.kind !== 'FIXED' && item.kind !== 'TIMEBLOCK' ? { kind: focus ? 'FOCUS' : 'MANUAL', ...(focus ? { category: focus.category } : {}) } : {}),
    ...(v.status === 'DONE' && item.status !== 'DONE' ? { doneAt: new Date() } : v.status === 'TODO' ? { doneAt: null } : {}) } });
  return { id: item.id };
}

/** Items laid out by the system (fixed items, time blocks, preset events) are dropped, not deleted, so planning never brings them back. */
export async function deleteItem(id: string, user: Actor) {
  requireAdmin(user, '工作日历仅管理员可用');
  const item = await ownItem(id, user);
  if (item.sourceKey) await db.workItem.update({ where: { id: item.id }, data: { status: 'DROPPED' } });
  else await db.workItem.delete({ where: { id: item.id } });
  return { id: item.id };
}

const focusNumbers = {
  targetValue: z.coerce.number().int().min(1, '目标数至少为 1').max(100_000, '目标数太大'),
  currentValue: z.coerce.number().int().min(0, '当前数不能小于 0').max(100_000, '当前数太大'),
  unit: z.string().trim().max(8, '单位不能超过 8 个字'),
};
const focusInput = z.object({
  level: z.enum(['MONTH', 'WEEK']),
  periodKey: z.string().trim(),
  title: z.string().trim().min(1, '请填写重心').max(200, '重心不能超过 200 字'),
  target: z.string().trim().max(200).default(''),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  targetValue: focusNumbers.targetValue.nullable().default(null),
  currentValue: focusNumbers.currentValue.default(0),
  unit: focusNumbers.unit.default(''),
  parentId: z.string().trim().max(191).nullable().default(null),
  category: categoryEnum.default('CONVERT'),
  status: z.enum(['TODO', 'DOING', 'DONE']).default('TODO'),
}).superRefine((v, ctx) => {
  if (v.level === 'MONTH' && !MONTH.safeParse(v.periodKey).success) ctx.addIssue({ code: 'custom', path: ['periodKey'], message: '月份格式应为 yyyy-MM' });
  if (v.level === 'WEEK' && (!DATE.safeParse(v.periodKey).success || weekday(v.periodKey) !== 1)) ctx.addIssue({ code: 'custom', path: ['periodKey'], message: '周重心按周一日期记录' });
  if (v.level === 'WEEK' && !v.parentId) ctx.addIssue({ code: 'custom', path: ['parentId'], message: '周重心必须关联一条月重心' });
});
const focusPatch = z.object({
  title: z.string().trim().min(1, '请填写重心').max(200).optional(), target: z.string().trim().max(200).optional(), progress: z.coerce.number().int().min(0).max(100).optional(),
  targetValue: focusNumbers.targetValue.nullable().optional(), currentValue: focusNumbers.currentValue.optional(), unit: focusNumbers.unit.optional(),
  parentId: z.string().trim().max(191).optional(), category: categoryEnum.optional(), status: z.enum(['TODO', 'DOING', 'DONE']).optional(), sort: z.coerce.number().int().min(0).max(99).optional(),
});
type Measured = { targetValue: number | null; currentValue: number; progress: number };
/** Progress in percent: the count against the number target when there is one, otherwise as entered. */
const percentOf = (f: Measured) => f.targetValue ? Math.min(100, Math.round(f.currentValue / f.targetValue * 100)) : f.progress;
/** What a progress record counts: the number when there is a target, otherwise the percent. */
const valueOf = (f: Measured) => f.targetValue ? f.currentValue : f.progress;

/** A week focus serves a month focus of the month the week starts or ends in. */
async function checkParent(parentId: string, week: string) {
  const parent = await db.focusGoal.findUnique({ where: { id: parentId } });
  if (!parent || parent.level !== 'MONTH' || ![monthOf(week), monthOf(addDays(week, 6))].includes(parent.periodKey)) throw new HttpError(400, '请选择这一周所在月份的月重心');
}

export async function createFocus(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以设定重心');
  const v = focusInput.parse(input);
  if (v.level === 'WEEK') await checkParent(v.parentId!, v.periodKey);
  const count = await db.focusGoal.count({ where: { level: v.level, periodKey: v.periodKey } });
  if (count >= 3) throw new HttpError(409, `${v.level === 'MONTH' ? '月' : '周'}重心最多 3 条，先调整已有的`);
  return db.focusGoal.create({ data: { ...v, progress: percentOf(v), parentId: v.level === 'WEEK' ? v.parentId : null, sort: count, createdBy: user.id }, select: { id: true } });
}

/** Every change of progress is recorded with the day (a number target set or removed starts the count over). */
export async function updateFocus(id: string, input: unknown, user: Actor, now = new Date()) {
  requireAdmin(user, '只有管理员可以设定重心');
  z.string().trim().min(1).max(191).parse(id);
  const v = focusPatch.parse(input);
  const focus = await db.focusGoal.findUnique({ where: { id } });
  if (!focus) throw new HttpError(404, '重心不存在');
  if (v.parentId !== undefined) {
    if (focus.level !== 'WEEK') throw new HttpError(400, '只有周重心关联月重心');
    await checkParent(v.parentId, focus.periodKey);
  }
  const { today } = await settings(now);
  const next = { ...focus, ...v };
  const progress = percentOf(next);
  await db.$transaction(async tx => {
    await tx.focusGoal.update({ where: { id }, data: { ...v, progress } });
    const from = valueOf(focus), to = valueOf({ ...next, progress });
    if (Boolean(focus.targetValue) === Boolean(next.targetValue) && from !== to) {
      await tx.focusProgressLog.create({ data: { focusId: id, userId: user.id, date: today, fromValue: from, toValue: to, target: next.targetValue } });
    }
  });
  return { id };
}

/** How much one person moved a focus on a day. */
export async function dayChange(focusId: string, userId: string, date: string) {
  const logs = await db.focusProgressLog.findMany({ where: { focusId, userId, date }, select: { fromValue: true, toValue: true } });
  return logs.reduce((sum, l) => sum + l.toValue - l.fromValue, 0);
}

/** The review's +1 / −1 on a focus with a number target. Returns the count and today's change. */
export async function stepFocus(id: string, input: unknown, user: Actor, now = new Date()) {
  requireAdmin(user, '只有管理员可以更新重心进度');
  z.string().trim().min(1).max(191).parse(id);
  const { delta } = z.object({ delta: z.coerce.number().int().refine(n => n === 1 || n === -1, '每次加一或减一') }).parse(input);
  const focus = await db.focusGoal.findUnique({ where: { id } });
  if (!focus) throw new HttpError(404, '重心不存在');
  if (!focus.targetValue) throw new HttpError(400, '先给这条重心填一个目标数');
  const { today } = await settings(now);
  const to = Math.max(0, focus.currentValue + delta);
  if (to !== focus.currentValue) {
    await db.$transaction(async tx => {
      const moved = await tx.focusGoal.updateMany({ where: { id, currentValue: focus.currentValue }, data: { currentValue: to, progress: percentOf({ ...focus, currentValue: to }) } });
      if (!moved.count) throw new HttpError(409, '进度刚被更新过，请刷新后再改');
      await tx.focusProgressLog.create({ data: { focusId: id, userId: user.id, date: today, fromValue: focus.currentValue, toValue: to, target: focus.targetValue } });
    });
  }
  return { id, currentValue: to, today: await dayChange(id, user.id, today) };
}

export async function deleteFocus(id: string, user: Actor) {
  requireAdmin(user, '只有管理员可以设定重心');
  z.string().trim().min(1).max(191).parse(id);
  const focus = await db.focusGoal.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
  if (!focus) throw new HttpError(404, '重心不存在');
  if (focus._count.children) throw new HttpError(409, `还有 ${focus._count.children} 条周重心关联这条月重心，先改关联或删除`);
  await db.focusGoal.delete({ where: { id } });
  return { id };
}

const blockInput = z.object({
  startTime: TIME, endTime: TIME, title: z.string().trim().min(1, '请填写时间块内容').max(200), category: categoryEnum.default('CONVERT'),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, '请至少选择一天').max(7).default([1, 2, 3, 4, 5]),
}).superRefine((v, ctx) => { if (v.endTime <= v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: '结束时间要晚于开始时间' }); });

export async function listTimeBlocks(user: Actor) {
  requireAdmin(user, '工作日历仅管理员可用');
  return db.timeBlock.findMany({ where: { userId: user.id, active: true }, orderBy: [{ startTime: 'asc' }, { sort: 'asc' }] });
}
export async function createTimeBlock(input: unknown, user: Actor) {
  requireAdmin(user, '工作日历仅管理员可用');
  const v = blockInput.parse(input);
  return db.timeBlock.create({ data: { ...v, weekdays: [...new Set(v.weekdays)].sort().join(','), userId: user.id }, select: { id: true } });
}
export async function updateTimeBlock(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '工作日历仅管理员可用');
  z.string().trim().min(1).max(191).parse(id);
  const block = await db.timeBlock.findFirst({ where: { id, userId: user.id } });
  if (!block) throw new HttpError(404, '时间块不存在');
  const raw = z.object({ active: z.boolean().optional() }).passthrough().parse(input);
  if (raw.active === false) { await db.timeBlock.update({ where: { id }, data: { active: false } }); return { id }; }
  const v = blockInput.parse({ startTime: block.startTime, endTime: block.endTime, title: block.title, category: block.category, weekdays: block.weekdays.split(',').map(Number), ...raw });
  await db.timeBlock.update({ where: { id }, data: { ...v, weekdays: [...new Set(v.weekdays)].sort().join(',') } });
  return { id };
}
