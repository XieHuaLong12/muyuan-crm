import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin, scope } from '@/lib/auth';
import { gupshupSource } from '@/lib/gupshup';
import { canonicalPhone } from '@/lib/contact-identity';
import { accessible } from './customer-service';
import { listWhatsAppMessages } from './whatsapp-message-service';
import { serviceWindow } from './whatsapp-window-service';
import { messageMediaHref } from './whatsapp-media-service';
import { claimIdentityMessage } from './identity-chain-service';
import { templatesConfigured } from './whatsapp-template-service';

/**
 * Message center: one conversation per customer with WhatsApp messages, newest first.
 * Unread = live customer messages after both this person's last opening and the business's last reply,
 * so archived local-sync history and conversations already answered never show up as unread.
 */
const LIVE_SOURCES = Prisma.sql`('gupshup','cloud_api')`;
const EPOCH = Prisma.sql`TIMESTAMP('1970-01-01 00:00:00')`;
const PAGE_SIZE = 30;

export const inboxQuery = z.object({
  q: z.string().trim().max(100).default(''),
  filter: z.enum(['all', 'unread', 'awaiting', 'unmatched']).default('all'),
  // Administrators may narrow to one salesperson; 'mine' is their own customers. Salespeople always see their own.
  ownerId: z.string().trim().max(191).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

type Row = { customerId: string; lastMessageAt: Date; lastOutboundAt: Date | null; unread: bigint | number };

function ownerCondition(user: Actor, ownerId: string) {
  if (user.role !== 'ADMIN') return Prisma.sql`AND c.ownerId = ${user.id}`;
  if (ownerId === 'mine') return Prisma.sql`AND c.ownerId = ${user.id}`;
  return ownerId ? Prisma.sql`AND c.ownerId = ${ownerId}` : Prisma.empty;
}

function conversationRows(user: Actor, query: z.infer<typeof inboxQuery>, page: { take: number; skip: number }) {
  const like = `%${query.q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  const search = query.q ? Prisma.sql`AND (c.name LIKE ${like} OR c.companyName LIKE ${like} OR c.country LIKE ${like} OR c.whatsapp LIKE ${like} OR c.phone LIKE ${like})` : Prisma.empty;
  const awaiting = query.filter === 'awaiting' ? Prisma.sql`AND t.lastMessageAt > COALESCE(t.lastOutboundAt, ${EPOCH})` : Prisma.empty;
  const unread = query.filter === 'unread' ? Prisma.sql`WHERE x.unread > 0` : Prisma.empty;
  return db.$queryRaw<Row[]>(Prisma.sql`
    SELECT x.* FROM (
      SELECT t.customerId, t.lastMessageAt, t.lastOutboundAt,
        (SELECT COUNT(*) FROM WhatsAppMessage u WHERE u.customerId = t.customerId AND u.direction = 'INBOUND' AND u.source IN ${LIVE_SOURCES}
          AND u.sentAt > GREATEST(COALESCE(r.readAt, ${EPOCH}), COALESCE(t.lastOutboundAt, ${EPOCH}))) AS unread
      FROM (SELECT customerId, MAX(sentAt) AS lastMessageAt, MAX(CASE WHEN direction = 'OUTBOUND' THEN sentAt END) AS lastOutboundAt
            FROM WhatsAppMessage GROUP BY customerId) t
      JOIN Customer c ON c.id = t.customerId
      LEFT JOIN WhatsAppReadState r ON r.customerId = t.customerId AND r.userId = ${user.id}
      WHERE c.deletedAt IS NULL ${ownerCondition(user, query.ownerId)} ${search} ${awaiting}
    ) x ${unread}
    ORDER BY x.lastMessageAt DESC, x.customerId ASC
    LIMIT ${page.take} OFFSET ${page.skip}`);
}

/** Conversations with unread customer messages among this person's own customers (the sidebar badge). */
export async function unreadConversationCount(user: Actor) {
  const rows = await db.$queryRaw<{ total: bigint | number }[]>(Prisma.sql`
    SELECT COUNT(*) AS total FROM (
      SELECT t.customerId FROM (SELECT customerId, MAX(CASE WHEN direction = 'OUTBOUND' THEN sentAt END) AS lastOutboundAt FROM WhatsAppMessage GROUP BY customerId) t
      JOIN Customer c ON c.id = t.customerId
      LEFT JOIN WhatsAppReadState r ON r.customerId = t.customerId AND r.userId = ${user.id}
      WHERE c.deletedAt IS NULL AND c.ownerId = ${user.id} AND EXISTS (
        SELECT 1 FROM WhatsAppMessage u WHERE u.customerId = t.customerId AND u.direction = 'INBOUND' AND u.source IN ${LIVE_SOURCES}
          AND u.sentAt > GREATEST(COALESCE(r.readAt, ${EPOCH}), COALESCE(t.lastOutboundAt, ${EPOCH})))
    ) x`);
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

const preview = (message: { content: string; messageType: string; fileName: string | null } | null | undefined) => {
  if (!message) return '';
  const placeholder = /^\[[^\]]*\]$/.test(message.content.trim());
  const label: Record<string, string> = { IMAGE: '图片', VIDEO: '视频', AUDIO: '语音', VOICE: '语音', DOCUMENT: '文件', FILE: '文件', STICKER: '贴纸', LOCATION: '位置', TEMPLATE: '模板消息' };
  if (label[message.messageType] && (placeholder || !message.content.trim())) return `[${label[message.messageType]}]${message.fileName ? ` ${message.fileName}` : ''}`;
  return message.content;
};

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
  lastMessage: { preview: string; direction: string; status: string } | null;
  window: { status: 'OPEN' | 'CLOSED' | 'UNKNOWN'; expiresAt: Date | null };
};
export type UnmatchedNumber = { key: string; peerPhone: string | null; peerName: string; lastMessage: string; lastMessageAt: Date; reason: string; count: number };
export type InboxPage = { query: z.infer<typeof inboxQuery>; conversations: InboxConversation[]; hasMore: boolean; unmatchedTotal: number; numbers: UnmatchedNumber[];
  sales: { id: string; name: string; role: string }[] };

export async function inboxConversations(user: Actor, input: unknown): Promise<InboxPage> {
  const query = inboxQuery.parse(input);
  if (query.filter === 'unmatched') return { query, conversations: [], hasMore: false, ...(await unmatchedNumbers(user)), sales: await salesOptions(user) };
  const rows = await conversationRows(user, query, { take: PAGE_SIZE + 1, skip: (query.page - 1) * PAGE_SIZE });
  const page = rows.slice(0, PAGE_SIZE), ids = page.map(row => row.customerId);
  const [customers, live] = await Promise.all([
    ids.length ? db.customer.findMany({ where: { AND: [scope(user), { id: { in: ids } }] }, select: { id: true, name: true, companyName: true, country: true, countryCode: true, stage: true,
      firstContactDueAt: true, firstContactAt: true, owner: { select: { id: true, name: true } },
      whatsappMessages: { orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 1, select: { content: true, direction: true, messageType: true, status: true, fileName: true } } } }) : [],
    windows(ids),
  ]);
  const byId = new Map(customers.map(customer => [customer.id, customer]));
  const now = new Date();
  const conversations = page.flatMap((row): InboxConversation[] => {
    const customer = byId.get(row.customerId);
    if (!customer) return [];
    const last = customer.whatsappMessages[0];
    const window = serviceWindow(live.get(customer.id) ?? null, now);
    return [{ id: customer.id, name: customer.name, companyName: customer.companyName, country: customer.country, countryCode: customer.countryCode,
      stage: customer.stage, owner: customer.owner, lastMessageAt: row.lastMessageAt, unread: Number(row.unread),
      awaiting: !row.lastOutboundAt || row.lastMessageAt > row.lastOutboundAt,
      firstContactOverdue: !customer.firstContactAt && !!customer.firstContactDueAt && customer.firstContactDueAt < now,
      lastMessage: last ? { preview: preview(last), direction: last.direction, status: last.status } : null,
      window: { status: window.conversationWindowStatus, expiresAt: window.conversationWindowExpiresAt } }];
  });
  const unmatched = user.role === 'ADMIN' ? await db.whatsAppUnmatchedMessage.count({ where: { status: 'PENDING', provider: { in: ['gupshup', 'cloud_api'] } } }) : 0;
  return { query, conversations, hasMore: rows.length > PAGE_SIZE, unmatchedTotal: unmatched, numbers: [], sales: await salesOptions(user) };
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

const threadQuery = z.object({ customerId: z.string().trim().min(1).max(191), before: z.string().trim().min(1).max(191).optional() });

/** One conversation: messages (oldest first), the customer's profile and what the composer may do. */
export async function inboxThread(user: Actor, input: unknown) {
  const { customerId, before } = threadQuery.parse(input);
  await accessible(customerId, user);
  const [chat, customer, task, events] = await Promise.all([
    listWhatsAppMessages(customerId, user, before),
    db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { id: true, name: true, companyName: true, country: true, countryCode: true, city: true,
      whatsapp: true, phone: true, phoneE164: true, language: true, stage: true, source: true, purchaseType: true, productInterest: true, productModel: true,
      quantity: true, inquiryAt: true, whatsappOptInStatus: true, owner: { select: { id: true, name: true } } } }),
    db.task.findFirst({ where: { customerId, deletedAt: null, status: { not: 'DONE' } }, orderBy: { dueDate: 'asc' }, select: { id: true, title: true, dueDate: true } }),
    db.stageHistory.findMany({ where: { customerId }, orderBy: { changedAt: 'desc' }, take: 4, select: { id: true, fromStage: true, toStage: true, changedAt: true, note: true } }),
  ]);
  const messages = chat.messages.map(message => ({ id: message.id, direction: message.direction, messageType: message.messageType, content: message.content,
    status: message.status, source: message.source, sentAt: message.sentAt, fileName: message.fileName, mimeType: message.mimeType,
    attachmentMetadata: message.attachmentMetadata, mediaHref: messageMediaHref(message) }));
  return { customer, nextTask: task, stageEvents: events, messages, nextCursor: chat.nextCursor,
    window: { status: chat.conversationWindowStatus, expiresAt: chat.conversationWindowExpiresAt, lastCustomerMessageAt: chat.lastCustomerMessageAt },
    sending: { configured: chat.configured, businessNumber: gupshupSource(), templates: templatesConfigured(), optedOut: customer.whatsappOptInStatus === 'OPTED_OUT' } };
}

/** On-demand Chinese translation of one customer message, through the translation service configured for lead imports. */
export async function translateMessage(user: Actor, input: unknown) {
  const { messageId } = z.object({ messageId: z.string().trim().min(1).max(191) }).parse(input);
  const message = await db.whatsAppMessage.findUnique({ where: { id: messageId }, select: { customerId: true, content: true } });
  if (!message) throw new HttpError(404, '消息不存在');
  await accessible(message.customerId, user);
  if (!message.content.trim() || /^\[[^\]]*\]$/.test(message.content.trim())) throw new HttpError(400, '这条消息没有可翻译的文字');
  const { translator } = await import('./meta-translation-service');
  const result = await (await translator()).translate(message.content.slice(0, 4000));
  if (result.pending) throw new HttpError(503, '翻译服务未配置或暂时不可用（管理员可在线索导入的「翻译服务配置」中设置）');
  return { text: result.text };
}
