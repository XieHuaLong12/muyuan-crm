import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin, scope } from '@/lib/auth';
import { gupshupSource } from '@/lib/gupshup';
import { canonicalPhone } from '@/lib/contact-identity';
import { isLegacyCustomer } from '@/lib/customer-group';
import { accessible } from './customer-service';
import { listWhatsAppMessages } from './whatsapp-message-service';
import { serviceWindow } from './whatsapp-window-service';
import { messageMediaHref } from './whatsapp-media-service';
import { claimIdentityMessage, reconcilePendingIdentityMessages } from './identity-chain-service';
import { lockIdentity, resolveActiveContact } from './contact-identity-service';
import { createInboundCustomer } from './whatsapp-webhook-service';
import { retryTransaction } from '@/lib/transaction-retry';
import { templatesConfigured } from './whatsapp-template-service';
import { queueFilters, workPriority } from './bos-sales-service';
import { messagePreview } from '@/lib/message-preview';
import type { CustomerTagView } from '@/lib/customer-tags';
import { tagsOf } from './customer-tag-service';
import { todoCount, todoCustomers, type TodoItem } from './todo-service';
import { storedTranslations } from './message-translation-service';

/**
 * Message center: one conversation per customer with WhatsApp messages, newest first.
 * Unread = live customer messages after both this person's last opening and the business's last reply,
 * so archived local-sync history and conversations already answered never show up as unread.
 */
const LIVE_SOURCES = Prisma.sql`('gupshup','cloud_api')`;
const EPOCH = Prisma.sql`TIMESTAMP('1970-01-01 00:00:00')`;
const PAGE_SIZE = 30;
/** Per customer: newest message and newest reply from the business. */
const LATEST = Prisma.sql`(SELECT customerId, MAX(sentAt) AS lastMessageAt, MAX(CASE WHEN direction = 'OUTBOUND' THEN sentAt END) AS lastOutboundAt
  FROM WhatsAppMessage GROUP BY customerId)`;
/** Live customer messages after both this person's last opening (r) and the business's last reply (t). */
const unreadJoin = (kind: 'LEFT' | 'INNER') => Prisma.sql`${kind === 'LEFT' ? Prisma.sql`LEFT JOIN` : Prisma.sql`JOIN`} WhatsAppMessage u
  ON u.customerId = t.customerId AND u.direction = 'INBOUND' AND u.source IN ${LIVE_SOURCES}
  AND u.sentAt > GREATEST(COALESCE(r.readAt, ${EPOCH}), COALESCE(t.lastOutboundAt, ${EPOCH}))`;

export const inboxQuery = z.object({
  q: z.string().trim().max(100).default(''),
  // pending = 待首联: assigned customers nobody has contacted yet, whether or not they have any messages.
  // todo = 待处理 (services/todo-service.ts): the customers worth handling now, with or without messages.
  filter: z.enum(['all', 'unread', 'awaiting', 'unmatched', 'pending', 'todo']).default('all'),
  // Administrators may narrow to one salesperson; 'mine' is their own customers. Salespeople always see their own.
  ownerId: z.string().trim().max(191).default(''),
  // Only customers carrying this tag, on every filter.
  tagId: z.string().trim().max(191).default(''),
  // Customer grades to show, comma separated: A, B, C, D and none (未评). Empty = every grade.
  grades: z.string().trim().max(40).default('').transform(value => value.split(',').filter(isGradeKey).join(',')),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/** Grade filter keys: the four lead grades, and none for customers without one. */
export const GRADE_KEYS = ['A', 'B', 'C', 'D', 'none'] as const;
type GradeKey = (typeof GRADE_KEYS)[number];
const isGradeKey = (value: string): value is GradeKey => (GRADE_KEYS as readonly string[]).includes(value);
const LETTERS = ['A', 'B', 'C', 'D'];
const gradeKeys = (grades: string) => grades.split(',').filter(isGradeKey);

function gradeCondition(grades: string) {
  const keys = gradeKeys(grades);
  if (!keys.length) return Prisma.empty;
  const letters = keys.filter(k => k !== 'none'), none = keys.includes('none');
  const parts = [...(letters.length ? [Prisma.sql`c.leadGrade IN (${Prisma.join(letters)})`] : []), ...(none ? [Prisma.sql`c.leadGrade NOT IN (${Prisma.join(LETTERS)})`] : [])];
  return Prisma.sql`AND (${Prisma.join(parts, ' OR ')})`;
}
function gradeWhere(grades: string): Prisma.CustomerWhereInput {
  const keys = gradeKeys(grades);
  if (!keys.length) return {};
  const letters = keys.filter(k => k !== 'none');
  return { OR: [...(letters.length ? [{ leadGrade: { in: letters } }] : []), ...(keys.includes('none') ? [{ leadGrade: { notIn: LETTERS } }] : [])] };
}

type Row = { customerId: string; lastMessageAt: Date; lastOutboundAt: Date | null; unread: bigint | number };

function ownerCondition(user: Actor, ownerId: string) {
  if (user.role !== 'ADMIN') return Prisma.sql`AND c.ownerId = ${user.id}`;
  if (ownerId === 'mine') return Prisma.sql`AND c.ownerId = ${user.id}`;
  return ownerId ? Prisma.sql`AND c.ownerId = ${ownerId}` : Prisma.empty;
}

function conversationRows(user: Actor, query: z.infer<typeof inboxQuery>, page: { take: number; skip: number }) {
  const like = `%${query.q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const tagged = Prisma.sql`EXISTS (SELECT 1 FROM CustomerTagLink l JOIN CustomerTag g ON g.id = l.tagId WHERE l.customerId = c.id AND g.name LIKE ${like})`;
  const search = query.q ? Prisma.sql`AND (c.name LIKE ${like} OR c.companyName LIKE ${like} OR c.country LIKE ${like} OR c.whatsapp LIKE ${like} OR c.phone LIKE ${like} OR ${tagged})` : Prisma.empty;
  const tag = query.tagId ? Prisma.sql`AND EXISTS (SELECT 1 FROM CustomerTagLink tl WHERE tl.customerId = c.id AND tl.tagId = ${query.tagId})` : Prisma.empty;
  const awaiting = query.filter === 'awaiting' ? Prisma.sql`AND t.lastMessageAt > COALESCE(t.lastOutboundAt, ${EPOCH})` : Prisma.empty;
  const unread = query.filter === 'unread' ? Prisma.sql`HAVING COUNT(u.id) > 0` : Prisma.empty;
  // Unread messages are joined and counted rather than looked up in a correlated subquery: MariaDB 11 rejects
  // subqueries that refer to a derived table's columns (error 1054), MySQL 8 and MariaDB 10 accept both forms.
  return db.$queryRaw<Row[]>(Prisma.sql`
    SELECT t.customerId, t.lastMessageAt, t.lastOutboundAt, COUNT(u.id) AS unread
    FROM ${LATEST} t
    JOIN Customer c ON c.id = t.customerId
    LEFT JOIN WhatsAppReadState r ON r.customerId = t.customerId AND r.userId = ${user.id}
    ${unreadJoin('LEFT')}
    WHERE c.deletedAt IS NULL ${ownerCondition(user, query.ownerId)} ${search} ${tag} ${gradeCondition(query.grades)} ${awaiting}
    GROUP BY t.customerId, t.lastMessageAt, t.lastOutboundAt
    ${unread}
    ORDER BY t.lastMessageAt DESC, t.customerId ASC
    LIMIT ${page.take} OFFSET ${page.skip}`);
}

/** Conversations with unread customer messages among this person's own customers (the sidebar badge). */
export async function unreadConversationCount(user: Actor) {
  const rows = await db.$queryRaw<{ total: bigint | number }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT t.customerId) AS total
    FROM ${LATEST} t
    JOIN Customer c ON c.id = t.customerId
    LEFT JOIN WhatsAppReadState r ON r.customerId = t.customerId AND r.userId = ${user.id}
    ${unreadJoin('INNER')}
    WHERE c.deletedAt IS NULL AND c.ownerId = ${user.id}`);
  return Number(rows[0]?.total ?? 0);
}

/** Newest unread customer message per conversation, for the notification feed (own customers only). */
export async function unreadMessagesSince(user: Actor, since: Date) {
  return db.$queryRaw<{ id: string; customerId: string; name: string; content: string; messageType: string; sentAt: Date }[]>(Prisma.sql`
    SELECT m.id, m.customerId, c.name, m.\`text\` AS content, m.messageType, m.sentAt
    FROM WhatsAppMessage m
    JOIN Customer c ON c.id = m.customerId
    LEFT JOIN WhatsAppReadState r ON r.customerId = m.customerId AND r.userId = ${user.id}
    WHERE c.deletedAt IS NULL AND c.ownerId = ${user.id} AND m.direction = 'INBOUND' AND m.source IN ${LIVE_SOURCES} AND m.sentAt >= ${since}
      AND m.sentAt > COALESCE(r.readAt, ${EPOCH})
      AND NOT EXISTS (SELECT 1 FROM WhatsAppMessage o WHERE o.customerId = m.customerId AND o.direction = 'OUTBOUND' AND o.sentAt >= m.sentAt)
      AND NOT EXISTS (SELECT 1 FROM WhatsAppMessage n WHERE n.customerId = m.customerId AND n.direction = 'INBOUND' AND n.source IN ${LIVE_SOURCES} AND (n.sentAt > m.sentAt OR (n.sentAt = m.sentAt AND n.id > m.id)))
    ORDER BY m.sentAt DESC LIMIT 20`);
}

/** Live-number service windows for a page of customers (only the configured Gupshup business number counts). */
async function windows(customerIds: string[]) {
  const accountId = gupshupSource();
  if (!accountId || !customerIds.length) return new Map<string, Date>();
  const rows = await db.whatsAppConversation.findMany({ where: { lastCustomerMessageAt: { not: null },
    contact: { provider: 'gupshup', accountId, customerId: { in: customerIds }, status: { in: ['MATCHED', 'MANUAL'] } } },
    select: { lastCustomerMessageAt: true, contact: { select: { customerId: true } } } });
  const latest = new Map<string, Date>();
  for (const row of rows) {
    const id = row.contact.customerId!, at = row.lastCustomerMessageAt!;
    if (!latest.has(id) || latest.get(id)! < at) latest.set(id, at);
  }
  return latest;
}

export type InboxConversation = {
  id: string; name: string; companyName: string; country: string; countryCode: string; stage: string; owner: { id: string; name: string };
  lastMessageAt: Date; unread: number; awaiting: boolean; firstContactOverdue: boolean;
  /** 旧客户 (lib/customer-group.ts): chats as usual, outside script testing. */
  legacy: boolean;
  lastMessage: { preview: string; direction: string; status: string } | null;
  window: { status: 'OPEN' | 'CLOSED' | 'UNKNOWN'; expiresAt: Date | null };
  tags: CustomerTagView[];
  /** A/B/C/D or empty, and why (shown when the pointer rests on the avatar). */
  grade: string; gradeReason: string;
};
export type UnmatchedNumber = { key: string; peerPhone: string | null; peerName: string; lastMessage: string; lastMessageAt: Date; reason: string; count: number };
export type PendingCustomer = { id: string; name: string; companyName: string; country: string; countryCode: string; source: string; leadGrade: string;
  purchaseType: string; productInterest: string; quantity: number | null; owner: { id: string; name: string }; assignedAt: Date | null; firstContactDueAt: Date | null;
  tags: CustomerTagView[]; gradeReason: string };
export type InboxPage = { query: z.infer<typeof inboxQuery>; conversations: InboxConversation[]; pending: PendingCustomer[]; pendingTotal: number;
  todo: TodoItem[]; todoTotal: number; hasMore: boolean; unmatchedTotal: number; numbers: UnmatchedNumber[]; sales: { id: string; name: string; role: string }[] };

/** Same owner narrowing as the conversation list, for queries written with Prisma. */
function ownerWhere(user: Actor, ownerId: string): Prisma.CustomerWhereInput {
  if (user.role !== 'ADMIN' || ownerId === 'mine') return { ownerId: user.id };
  return ownerId ? { ownerId } : {};
}

/** Search and tag narrowing for the lists written with Prisma (待首联, 待处理), as the conversation list does in SQL. */
function listWhere(user: Actor, query: z.infer<typeof inboxQuery>): Prisma.CustomerWhereInput {
  const search: Prisma.CustomerWhereInput = query.q ? { OR: [{ name: { contains: query.q } }, { companyName: { contains: query.q } }, { country: { contains: query.q } },
    { whatsapp: { contains: query.q } }, { phone: { contains: query.q } }, { tagLinks: { some: { tag: { name: { contains: query.q } } } } }] } : {};
  return { AND: [scope(user), ownerWhere(user, query.ownerId), search, query.tagId ? { tagLinks: { some: { tagId: query.tagId } } } : {}, gradeWhere(query.grades)] };
}

/** 待首联: the work queue's "new assignment, not contacted yet" customers, so the number matches 今日工作 and the top bar. */
const pendingWhere = (user: Actor, ownerId: string, now: Date): Prisma.CustomerWhereInput => ({ AND: [scope(user), ownerWhere(user, ownerId), queueFilters(now).new] });
const PENDING_LIMIT = 500;

/** Pending customers ranked like 今日工作 (late first, then good forms and soon deadlines), one page at a time. */
async function pendingCustomers(user: Actor, query: z.infer<typeof inboxQuery>, now: Date) {
  const rows = await db.customer.findMany({ where: { AND: [listWhere(user, query), queueFilters(now).new] }, orderBy: [{ firstContactDueAt: 'asc' }, { id: 'asc' }], take: PENDING_LIMIT,
    select: { id: true, name: true, companyName: true, country: true, countryCode: true, source: true, leadGrade: true, leadGradeReason: true, purchaseType: true, productInterest: true, quantity: true,
      owner: { select: { id: true, name: true } }, assignedAt: true, firstContactDueAt: true, aiIntent: true, aiScore: true, lastInboundAt: true, lastContactAt: true } });
  const ranked = rows.map(c => ({ c, score: workPriority({ deadline: c.firstContactDueAt, firstContactPending: true, leadGrade: c.leadGrade, purchaseType: c.purchaseType,
    aiIntent: c.aiIntent, aiScore: c.aiScore, lastInboundAt: c.lastInboundAt, lastOutboundAt: null, lastFollowUpAt: null, lastContactAt: c.lastContactAt, staleQuoteSentAt: null }, now).score }))
    .sort((a, b) => b.score - a.score || (a.c.firstContactDueAt?.getTime() ?? Infinity) - (b.c.firstContactDueAt?.getTime() ?? Infinity) || a.c.id.localeCompare(b.c.id));
  const skip = (query.page - 1) * PAGE_SIZE, shown = ranked.slice(skip, skip + PAGE_SIZE);
  const tags = await tagsOf(shown.map(({ c }) => c.id));
  const pending = shown.map(({ c }): PendingCustomer => ({ id: c.id, name: c.name, companyName: c.companyName, country: c.country,
    countryCode: c.countryCode, source: c.source, leadGrade: c.leadGrade, purchaseType: c.purchaseType, productInterest: c.productInterest, quantity: c.quantity,
    owner: c.owner, assignedAt: c.assignedAt, firstContactDueAt: c.firstContactDueAt, tags: tags.get(c.id) ?? [], gradeReason: c.leadGradeReason }));
  return { pending, hasMore: ranked.length > skip + PAGE_SIZE };
}

export async function inboxConversations(user: Actor, input: unknown): Promise<InboxPage> {
  const query = inboxQuery.parse(input);
  const now = new Date();
  // The chips show their counts on every filter, so salespeople see new assignments and urgent customers while answering chats.
  const [pendingTotal, todoTotal] = await Promise.all([
    db.customer.count({ where: pendingWhere(user, query.ownerId, now) }),
    todoCount({ AND: [scope(user), ownerWhere(user, query.ownerId)] }, now),
  ]);
  const totals = { pendingTotal, todoTotal, todo: [] as TodoItem[], pending: [] as PendingCustomer[] };
  if (query.filter === 'unmatched') return { query, conversations: [], ...totals, hasMore: false, ...(await unmatchedNumbers(user)), sales: await salesOptions(user) };
  if (query.filter === 'pending' || query.filter === 'todo') {
    const [page, sales] = await Promise.all([
      query.filter === 'pending' ? pendingCustomers(user, query, now) : todoCustomers(user, listWhere(user, query), query, PAGE_SIZE, now),
      salesOptions(user),
    ]);
    const unmatchedTotal = user.role === 'ADMIN' ? await db.whatsAppUnmatchedMessage.count({ where: { status: 'PENDING', provider: { in: ['gupshup', 'cloud_api'] } } }) : 0;
    return { query, conversations: [], ...totals, ...('pending' in page ? { pending: page.pending } : { todo: page.todo }), hasMore: page.hasMore, unmatchedTotal, numbers: [], sales };
  }
  const rows = await conversationRows(user, query, { take: PAGE_SIZE + 1, skip: (query.page - 1) * PAGE_SIZE });
  const page = rows.slice(0, PAGE_SIZE), ids = page.map(row => row.customerId);
  const [customers, live, tags] = await Promise.all([
    ids.length ? db.customer.findMany({ where: { AND: [scope(user), { id: { in: ids } }] }, select: { id: true, name: true, companyName: true, country: true, countryCode: true, stage: true, leadGrade: true, leadGradeReason: true,
      firstContactDueAt: true, firstContactAt: true, inquiryAt: true, createdAt: true, owner: { select: { id: true, name: true } },
      whatsappMessages: { orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 1, select: { content: true, direction: true, messageType: true, status: true, fileName: true } } } }) : [],
    windows(ids),
    tagsOf(ids),
  ]);
  const byId = new Map(customers.map(customer => [customer.id, customer]));
  const conversations = page.flatMap((row): InboxConversation[] => {
    const customer = byId.get(row.customerId);
    if (!customer) return [];
    const last = customer.whatsappMessages[0];
    const window = serviceWindow(live.get(customer.id) ?? null, now);
    return [{ id: customer.id, name: customer.name, companyName: customer.companyName, country: customer.country, countryCode: customer.countryCode,
      stage: customer.stage, owner: customer.owner, lastMessageAt: row.lastMessageAt, unread: Number(row.unread),
      awaiting: !row.lastOutboundAt || row.lastMessageAt > row.lastOutboundAt,
      firstContactOverdue: !customer.firstContactAt && !!customer.firstContactDueAt && customer.firstContactDueAt < now,
      legacy: isLegacyCustomer(customer),
      lastMessage: last ? { preview: messagePreview(last), direction: last.direction, status: last.status } : null,
      window: { status: window.conversationWindowStatus, expiresAt: window.conversationWindowExpiresAt }, tags: tags.get(customer.id) ?? [],
      grade: customer.leadGrade, gradeReason: customer.leadGradeReason }];
  });
  const unmatched = user.role === 'ADMIN' ? await db.whatsAppUnmatchedMessage.count({ where: { status: 'PENDING', provider: { in: ['gupshup', 'cloud_api'] } } }) : 0;
  return { query, conversations, ...totals, hasMore: rows.length > PAGE_SIZE, unmatchedTotal: unmatched, numbers: [], sales: await salesOptions(user) };
}

async function salesOptions(user: Actor) {
  if (user.role !== 'ADMIN') return [];
  return db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true }, orderBy: [{ role: 'asc' }, { name: 'asc' }] });
}

/** Numbers whose messages could not be tied to one customer (shared or invalid numbers). Administrators link them. */
async function unmatchedNumbers(user: Actor) {
  requireAdmin(user, '未关联号码由管理员处理');
  const items = await db.whatsAppUnmatchedMessage.findMany({ where: { status: 'PENDING', provider: { in: ['gupshup', 'cloud_api'] } },
    orderBy: { sentAt: 'desc' }, take: 300, select: { id: true, peerPhone: true, peerName: true, content: true, sentAt: true, reason: true, conversationId: true } });
  const numbers = new Map<string, UnmatchedNumber>();
  for (const item of items) {
    const key = item.peerPhone || item.conversationId;
    const current = numbers.get(key);
    if (current) current.count++;
    else numbers.set(key, { key, peerPhone: item.peerPhone, peerName: item.peerName, lastMessage: item.content, lastMessageAt: item.sentAt, reason: item.reason, count: 1 });
  }
  return { numbers: [...numbers.values()], unmatchedTotal: items.length };
}

/** Customers an administrator may link a number to: same number first, then name/company matches. */
export async function linkCandidates(user: Actor, input: unknown) {
  requireAdmin(user, '未关联号码由管理员处理');
  const v = z.object({ key: z.string().trim().min(1).max(191), q: z.string().trim().max(100).default('') }).parse(input);
  const phone = canonicalPhone(v.key, undefined, true);
  const select = { id: true, name: true, companyName: true, country: true, stage: true, owner: { select: { name: true } } } as const;
  const [byPhone, bySearch] = await Promise.all([
    phone ? db.customer.findMany({ where: { deletedAt: null, OR: [{ phoneE164: phone }, { whatsappNormalized: phone.slice(1) }, { contactIdentities: { some: { kind: 'PHONE', normalized: phone } } }] }, select, take: 10 }) : [],
    v.q.length >= 2 ? db.customer.findMany({ where: { deletedAt: null, OR: [{ name: { contains: v.q } }, { companyName: { contains: v.q } }, { email: { contains: v.q } }] }, select, take: 10 }) : [],
  ]);
  const seen = new Set<string>();
  return { candidates: [...byPhone.map(c => ({ ...c, samePhone: true })), ...bySearch.map(c => ({ ...c, samePhone: false }))].filter(c => !seen.has(c.id) && !!seen.add(c.id)) };
}

/** Links every pending message from one number to the chosen customer; later messages follow automatically. */
export async function linkUnmatchedNumber(user: Actor, input: unknown) {
  requireAdmin(user, '未关联号码由管理员处理');
  const v = z.object({ key: z.string().trim().min(1).max(191), customerId: z.string().trim().min(1).max(191) }).parse(input);
  const items = await db.whatsAppUnmatchedMessage.findMany({ where: { status: 'PENDING', provider: { in: ['gupshup', 'cloud_api'] }, OR: [{ peerPhone: v.key }, { conversationId: v.key }] },
    orderBy: { sentAt: 'asc' }, take: 200, select: { id: true } });
  if (!items.length) throw new HttpError(404, '这个号码没有待关联的消息');
  for (const item of items) await claimIdentityMessage({ itemId: item.id, customerId: v.customerId, reason: '消息中心：管理员确认号码归属' }, user);
  return { linked: items.length, customerId: v.customerId };
}

/**
 * Re-runs matching for messages waiting on a number: numbers no customer in the customer center has become new
 * customers (as live inbound messages now do), numbers with exactly one customer are linked, and numbers shared
 * by several customers stay for a person to choose.
 */
export async function retryUnmatchedNumbers(user: Actor, input: unknown) {
  requireAdmin(user, '未关联号码由管理员处理');
  z.object({}).strict().parse(input ?? {});
  const pending = await db.whatsAppUnmatchedMessage.findMany({ where: { status: 'PENDING', provider: 'gupshup', direction: 'inbound', peerPhone: { not: null } },
    orderBy: { sentAt: 'asc' }, take: 500, select: { id: true, peerPhone: true, peerName: true, sentAt: true, attachments: true } });
  const firstByPhone = new Map<string, (typeof pending)[number]>();
  for (const item of pending) if (!firstByPhone.has(item.peerPhone!)) firstByPhone.set(item.peerPhone!, item);
  let created = 0;
  for (const [phone, first] of firstByPhone) {
    let referral = false;
    try { referral = !!(JSON.parse(first.attachments) as { raw?: { referral?: unknown } }).raw?.referral; } catch { referral = false; }
    created += await retryTransaction(() => db.$transaction(async tx => {
      await lockIdentity(tx);
      if ((await resolveActiveContact({ phones: [phone] }, tx)).status !== 'UNMATCHED') return 0;
      await createInboundCustomer(tx, { phone, name: first.peerName, referral, at: first.sentAt });
      return 1;
    }));
  }
  const result = await reconcilePendingIdentityMessages({ limit: 200 }, user);
  // Imported live messages are real inbound evidence: they open the 24-hour window like a fresh webhook would.
  const imported = await db.whatsAppUnmatchedMessage.findMany({ where: { id: { in: pending.map(item => item.id) }, status: 'IMPORTED', canonicalConversationId: { not: null } },
    select: { canonicalConversationId: true, sentAt: true } });
  for (const item of imported) await db.whatsAppConversation.updateMany({ where: { id: item.canonicalConversationId!,
    OR: [{ lastCustomerMessageAt: null }, { lastCustomerMessageAt: { lt: item.sentAt } }] }, data: { lastCustomerMessageAt: item.sentAt } });
  const left = await db.whatsAppUnmatchedMessage.count({ where: { status: 'PENDING', provider: { in: ['gupshup', 'cloud_api'] } } });
  return { createdCustomers: created, imported: result.imported, remaining: left };
}

const threadQuery = z.object({ customerId: z.string().trim().min(1).max(191), before: z.string().trim().min(1).max(191).optional() });

/** One conversation: messages (oldest first), the customer's profile and what the composer may do. */
export async function inboxThread(user: Actor, input: unknown) {
  const { customerId, before } = threadQuery.parse(input);
  await accessible(customerId, user);
  const [chat, customer, task, events, tags, mark, deals, suggestion] = await Promise.all([
    listWhatsAppMessages(customerId, user, before),
    db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { id: true, name: true, companyName: true, country: true, countryCode: true, city: true,
      whatsapp: true, phone: true, phoneE164: true, language: true, stage: true, source: true, purchaseType: true, productInterest: true, productModel: true,
      quantity: true, inquiryAt: true, createdAt: true, whatsappOptInStatus: true, owner: { select: { id: true, name: true } },
      aiSummary: true, aiNextAction: true, aiLastAnalyzedAt: true, leadGrade: true, leadGradeReason: true, leadGradeSource: true, leadGradedAt: true,
      invalidReason: true, currency: true, autoTranslate: true } }),
    db.task.findFirst({ where: { customerId, deletedAt: null, status: { not: 'DONE' } }, orderBy: { dueDate: 'asc' }, select: { id: true, title: true, dueDate: true } }),
    db.stageHistory.findMany({ where: { customerId }, orderBy: { changedAt: 'desc' }, take: 4, select: { id: true, fromStage: true, toStage: true, changedAt: true, note: true, changedBy: true } }),
    tagsOf([customerId]),
    db.pendingMark.findUnique({ where: { customerId }, select: { note: true, dueAt: true } }),
    db.deal.count({ where: { customerId } }),
    // DeepSeek's newest open grade suggestion from a customer reply (accepted or dismissed from the avatar).
    db.outreachReply.findFirst({ where: { customerId, gradeSuggestionStatus: 'PENDING' }, orderBy: { receivedAt: 'desc' },
      select: { id: true, gradeSuggestion: true, reason: true, receivedAt: true } }),
  ]);
  // Who changed the stage: a person's name, or 系统 for message facts and deals recorded automatically.
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set(events.map(e => e.changedBy))] } }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
  const stageEvents = events.map(({ changedBy, ...e }) => ({ ...e, by: e.note.startsWith('SYSTEM') ? '系统' : people.get(changedBy) ?? '—' }));
  const translated = await storedTranslations(chat.messages.map(message => message.id));
  const messages = chat.messages.map(message => ({ id: message.id, direction: message.direction, messageType: message.messageType, content: message.content,
    status: message.status, source: message.source, sentAt: message.sentAt, fileName: message.fileName, mimeType: message.mimeType,
    attachmentMetadata: message.attachmentMetadata, mediaHref: messageMediaHref(message), translation: translated.get(message.id) ?? null }));
  return { customer: { ...customer, legacy: isLegacyCustomer(customer), hasDeal: deals > 0 }, nextTask: task, stageEvents, tags: tags.get(customerId) ?? [], pendingMark: mark,
    gradeSuggestion: suggestion && suggestion.gradeSuggestion && suggestion.gradeSuggestion !== customer.leadGrade ? suggestion : null,
    messages, nextCursor: chat.nextCursor,
    window: { status: chat.conversationWindowStatus, expiresAt: chat.conversationWindowExpiresAt, lastCustomerMessageAt: chat.lastCustomerMessageAt },
    sending: { configured: chat.configured, businessNumber: gupshupSource(), templates: templatesConfigured(), optedOut: customer.whatsappOptInStatus === 'OPTED_OUT' },
    // AI drafts, translation and summaries need DeepSeek; the chat shows why when it is missing.
    ai: { configured: !!process.env.DEEPSEEK_API_KEY?.trim() } };
}
