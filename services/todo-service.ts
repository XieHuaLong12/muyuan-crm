import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { bosDateRange } from '@/lib/bos';
import { TERMINAL_STAGES } from '@/lib/constants';
import { currentCustomers, isLegacyCustomer } from '@/lib/customer-group';
import { staleQuotes } from '@/lib/metrics';
import { messagePreview } from '@/lib/message-preview';
import { readConfig } from '@/lib/outreach';
import { GOOD_GRADES, STALE_QUOTE_MS, TODO_GROUPS, todoReasons, type TodoGroup } from '@/lib/todo';
import { accessible } from './customer-service';
import { queueFilters, workPriority } from './bos-sales-service';
import { tagsOf } from './customer-tag-service';

const TODO_LIMIT = 500;
const GROUP_ORDER: TodoGroup[] = ['LATE', 'TODAY', 'MINE'];
const ACTIVE: Prisma.CustomerWhereInput = { stage: { notIn: [...TERMINAL_STAGES] } };

/**
 * 待处理 in the database: the same five rules as lib/todo.ts todoReasons (which words each one), so the chip count
 * and the list agree. The first-contact and waiting rules reuse the work queues' own definitions.
 */
export function todoWhere(now: Date, endOfToday: Date): Prisma.CustomerWhereInput {
  const queues = queueFilters(endOfToday);
  return { OR: [
    { AND: [queues.new, { leadGrade: { in: [...GOOD_GRADES] }, firstContactDueAt: { lt: now } }] },
    { AND: [queues.waiting, { OR: [{ leadGrade: { in: [...GOOD_GRADES] } }, { bestReplyQuality: 'HIGH' }, { aiIntent: 'HIGH' }] }] },
    { AND: [currentCustomers, ACTIVE, { OR: [
      { nextFollowUpAt: { lt: endOfToday } },
      // Tasks the system creates (reply reminders, script follow-ups) only restate rules 1–2 for everyone; a task a
      // person set up is a promise.
      { tasks: { some: { deletedAt: null, status: { not: 'DONE' }, automationKey: null, dueDate: { lt: endOfToday } } } },
      { quotations: { some: staleQuotes(now, {}) } },
    ] }] },
    { pendingMark: { dueAt: { lte: now } } },
  ] };
}

export type TodoQuery = { q: string; ownerId: string; tagId: string; grades: string; page: number };

const select = {
  id: true, name: true, companyName: true, country: true, countryCode: true, stage: true, owner: { select: { id: true, name: true } },
  leadGrade: true, leadGradeReason: true, purchaseType: true, aiIntent: true, aiScore: true, bestReplyQuality: true, inquiryAt: true, createdAt: true,
  firstContactDueAt: true, firstContactAt: true, contactedAt: true, lastInboundAt: true, lastOutboundAt: true, lastFollowUpAt: true, lastContactAt: true, nextFollowUpAt: true,
  pendingMark: { select: { note: true, dueAt: true } },
  whatsappMessages: { orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 1, select: { content: true, direction: true, sentAt: true, messageType: true, fileName: true } },
} satisfies Prisma.CustomerSelect;

export type TodoItem = {
  id: string; name: string; companyName: string; country: string; countryCode: string; stage: string; owner: { id: string; name: string };
  group: TodoGroup; groupLabel: string; reasons: string[]; marked: boolean;
  lastMessage: { preview: string; direction: string; sentAt: Date } | null;
  tags: { id: string; name: string; color: string }[];
  grade: string; gradeReason: string;
};

/** The 待处理 list: grouped (已超时, 今天要做, 我标记的) and, within a group, in 今日跟进's order. */
export async function todoCustomers(user: Actor, scopeWhere: Prisma.CustomerWhereInput, query: TodoQuery, pageSize: number, now = new Date()) {
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, outreachConfig: true } });
  const { end } = bosDateRange(now, settings.timezone);
  const config = readConfig(settings.outreachConfig);
  const where: Prisma.CustomerWhereInput = { AND: [scopeWhere, todoWhere(now, end)] };
  const rows = await db.customer.findMany({ where, take: TODO_LIMIT, select: {
    ...select,
    tasks: { where: { deletedAt: null, status: { not: 'DONE' }, automationKey: null, dueDate: { lt: end } }, orderBy: { dueDate: 'asc' }, take: 1, select: { title: true, dueDate: true } },
    quotations: { where: { status: 'SENT', sentAt: { lt: new Date(now.getTime() - STALE_QUOTE_MS) } }, orderBy: { sentAt: 'asc' }, take: 1, select: { sentAt: true } },
  } });
  const ranked = rows.map(c => {
    const facts = { ...c, legacy: isLegacyCustomer(c), task: c.tasks[0] ?? null, staleQuoteSentAt: c.quotations[0]?.sentAt ?? null, mark: c.pendingMark };
    const judged = todoReasons(facts, now, end, settings.timezone, config.hotReplyHours) ?? { group: 'MINE' as const, reasons: ['待处理'] };
    // Deadline and signals as 今日跟进 reads them, so the two lists put customers in the same order.
    const deadline = [c.firstContactDueAt && !c.firstContactAt ? c.firstContactDueAt : null, c.nextFollowUpAt, facts.task?.dueDate ?? null]
      .filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const score = workPriority({ deadline, firstContactPending: !!c.firstContactDueAt && !c.firstContactAt,
      leadGrade: c.leadGrade, purchaseType: c.purchaseType, aiIntent: c.aiIntent, aiScore: c.aiScore, bestReplyQuality: c.bestReplyQuality, lastInboundAt: c.lastInboundAt,
      lastOutboundAt: c.lastOutboundAt, lastFollowUpAt: c.lastFollowUpAt, lastContactAt: c.lastContactAt, staleQuoteSentAt: facts.staleQuoteSentAt }, now).score;
    return { c, ...judged, score };
  }).sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || b.score - a.score || a.c.id.localeCompare(b.c.id));
  const skip = (query.page - 1) * pageSize, page = ranked.slice(skip, skip + pageSize);
  const tags = await tagsOf(page.map(row => row.c.id));
  const todo = page.map(({ c, group, reasons }): TodoItem => {
    const last = c.whatsappMessages[0];
    return { id: c.id, name: c.name, companyName: c.companyName, country: c.country, countryCode: c.countryCode, stage: c.stage, owner: c.owner,
      group, groupLabel: TODO_GROUPS[group], reasons, marked: !!c.pendingMark,
      lastMessage: last ? { preview: messagePreview(last), direction: last.direction, sentAt: last.sentAt } : null, tags: tags.get(c.id) ?? [],
      grade: c.leadGrade, gradeReason: c.leadGradeReason };
  });
  return { todo, hasMore: ranked.length > skip + pageSize };
}

/** The chip's number: same rules, counted in the database. */
export async function todoCount(scopeWhere: Prisma.CustomerWhereInput, now = new Date()) {
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  return db.customer.count({ where: { AND: [scopeWhere, todoWhere(now, bosDateRange(now, timezone).end)] } });
}

const markInput = z.object({
  customerId: z.string().trim().min(1).max(191),
  note: z.string().trim().max(200, '提醒最多 200 个字').default(''),
  // When it appears in 待处理; empty = now.
  dueAt: z.string().datetime({ offset: true, message: '提醒时间格式不对' }).nullable().default(null),
});
const clearInput = z.object({ customerId: z.string().trim().min(1).max(191) });

/** 标为待处理 (or change the reminder): one mark per customer, shown to everyone who sees the customer. */
export async function markTodo(input: unknown, user: Actor, now = new Date()) {
  const v = markInput.parse(input);
  await accessible(v.customerId, user);
  const dueAt = v.dueAt ? new Date(v.dueAt) : now;
  if (dueAt.getTime() > now.getTime() + 366 * 86400_000) throw new HttpError(400, '提醒时间最远一年以后');
  const mark = await db.pendingMark.upsert({ where: { customerId: v.customerId },
    create: { customerId: v.customerId, note: v.note, dueAt, createdBy: user.id }, update: { note: v.note, dueAt, createdBy: user.id },
    select: { note: true, dueAt: true } });
  return { mark };
}

/** 处理完: the mark goes; rules 1–4 drop a customer by themselves once handled. */
export async function clearTodo(input: unknown, user: Actor) {
  const v = clearInput.parse(input);
  await accessible(v.customerId, user);
  await db.pendingMark.deleteMany({ where: { customerId: v.customerId } });
  return { mark: null };
}
