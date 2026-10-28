import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { canonicalEmail } from '@/lib/contact-identity';
import { emailDomain, normalizeDomain } from '@/lib/radar';

type Client = Prisma.TransactionClient | typeof db;

/**
 * 禁发名单 (docs/CUSTOMER_RADAR_COLD_EMAIL.md §4.9): addresses and domains never to mail, for good or until a date.
 * The 90-day no-reply and 180-day not-interested pauses are entries with an end date, so the check before every
 * mail reads one table.
 */

export const SUPPRESSION_REASONS = {
  UNSUBSCRIBE: '退订', HARD_BOUNCE: '硬退信', CUSTOMER: '已是客户', NOT_INTERESTED: '不感兴趣', NO_REPLY: '序列无回复', UNRELATED: '无关或推销', MANUAL: '手动',
} as const;
export type SuppressionReason = keyof typeof SUPPRESSION_REASONS;
const DAY = 24 * 3600_000;

/** Adds an entry, or extends the existing one for the same value and reason (a permanent entry stays permanent). */
export async function suppress(client: Client, input: { scope: 'EMAIL' | 'DOMAIN'; value: string; reason: SuppressionReason; days?: number | null; note?: string; actorId?: string | null }) {
  const value = input.value.trim().toLowerCase().slice(0, 191);
  if (!value) return;
  const expiresAt = input.days ? new Date(Date.now() + input.days * DAY) : null;
  const existing = await client.radarSuppression.findUnique({ where: { scope_value_reason: { scope: input.scope, value, reason: input.reason } } });
  if (!existing) {
    await client.radarSuppression.create({ data: { scope: input.scope, value, reason: input.reason, expiresAt, note: (input.note ?? '').slice(0, 300), createdById: input.actorId ?? null } })
      .catch(error => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; });
    return;
  }
  const longer = existing.expiresAt !== null && (expiresAt === null || expiresAt > existing.expiresAt);
  if (longer) await client.radarSuppression.update({ where: { id: existing.id }, data: { expiresAt, ...(input.note ? { note: input.note.slice(0, 300) } : {}) } });
}

/** The entry that stops a mail to this address (by the address or its domain), or null. */
export async function suppressionFor(client: Client, address: string, domains: string[] = [], now = new Date()) {
  const email = address.trim().toLowerCase();
  const domainList = [...new Set([emailDomain(email), ...domains].map(d => d.trim().toLowerCase()).filter(Boolean))];
  return client.radarSuppression.findFirst({ where: {
    OR: [{ scope: 'EMAIL', value: email }, ...(domainList.length ? [{ scope: 'DOMAIN', value: { in: domainList } }] : [])],
    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
  }, orderBy: { createdAt: 'asc' } });
}

const manualInput = z.object({
  value: z.string().trim().min(3, '请填写邮箱或域名').max(191),
  note: z.string().trim().max(300).default(''),
  days: z.coerce.number().int().min(1).max(3650).nullable().default(null),
});

export async function listSuppressions(user: Actor, query: { q?: string } = {}) {
  requireAdmin(user, '只有管理员可以管理禁发名单');
  const q = z.string().trim().max(100).catch('').parse(query.q ?? '');
  const rows = await db.radarSuppression.findMany({ where: q ? { value: { contains: q.toLowerCase() } } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  const now = new Date();
  return rows.map(r => ({ ...r, reasonLabel: SUPPRESSION_REASONS[r.reason as SuppressionReason] ?? r.reason, active: !r.expiresAt || r.expiresAt > now }));
}

/** 手动禁发: an address ("buyer@shop.fr") or a whole domain ("shop.fr" or a site address). */
export async function addSuppression(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以管理禁发名单');
  const v = manualInput.parse(input);
  const email = canonicalEmail(v.value);
  const domain = email ? '' : normalizeDomain(v.value);
  if (!email && !domain) throw new HttpError(400, '请填写有效的邮箱地址或域名');
  await suppress(db, { scope: email ? 'EMAIL' : 'DOMAIN', value: email ?? domain, reason: 'MANUAL', days: v.days, note: v.note, actorId: user.id });
  return { scope: email ? 'EMAIL' : 'DOMAIN', value: email ?? domain };
}

export async function deleteSuppression(id: string, user: Actor) {
  requireAdmin(user, '只有管理员可以管理禁发名单');
  z.string().trim().min(1).max(191).parse(id);
  const removed = await db.radarSuppression.deleteMany({ where: { id } });
  if (!removed.count) throw new HttpError(404, '禁发记录不存在');
  return { id };
}
