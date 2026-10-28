import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { dayKey, localDate } from '@/lib/time';
import { CUSTOMER_TYPES, OPEN_STATUSES, PROSPECT_STATUSES, mailability, prospectStatusEnum, rankEmails, readRadarConfig, sendable, type ProspectStatus } from '@/lib/radar';
import { deepSeekConfigured } from './deepseek-customer-service';
import { verifierConfigured } from './radar-scoring-service';
import { stopSequence } from './radar-queue-service';

/** The radar's card wall and list (docs/CUSTOMER_RADAR_COLD_EMAIL.md §6). Administrators only: sales meet these companies once they reply. */

export const RADAR_PAGE_SIZE = 60;
const listQuery = z.object({
  view: z.union([z.enum(['OPEN', 'ALL']), prospectStatusEnum]).catch('OPEN').default('OPEN'),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional().catch(undefined),
  grade: z.enum(['A', 'B', 'C', 'UNSCORED']).optional().catch(undefined),
  email: z.enum(['SENDABLE', 'PENDING', 'NONE']).optional().catch(undefined),
  q: z.string().trim().max(100).catch('').default(''),
  today: z.enum(['1']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});
export type RadarListQuery = z.infer<typeof listQuery>;

const sendableEmail = { bouncedAt: null, verifyStatus: { in: ['VALID', 'RISKY'] } } satisfies Prisma.RadarEmailWhereInput;
const isoDay = (value: Date) => value.toISOString();

async function todayStart() {
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  return localDate(`${dayKey(new Date(), timezone)}T00:00:00`, timezone);
}

function whereOf(v: RadarListQuery, since: Date): Prisma.RadarProspectWhereInput {
  const and: Prisma.RadarProspectWhereInput[] = [];
  if (v.view === 'OPEN') and.push({ status: { in: [...OPEN_STATUSES] } });
  else if (v.view !== 'ALL') and.push({ status: v.view });
  if (v.country) and.push({ country: v.country });
  if (v.grade) and.push(v.grade === 'UNSCORED' ? { grade: '' } : { grade: v.grade });
  if (v.email === 'SENDABLE') and.push({ emails: { some: sendableEmail } });
  if (v.email === 'PENDING') and.push({ status: 'NEW', emails: { none: sendableEmail } });
  if (v.email === 'NONE') and.push({ status: 'NO_EMAIL' });
  if (v.today) and.push({ discoveredAt: { gte: since } });
  if (v.q) and.push({ OR: [{ name: { contains: v.q } }, { city: { contains: v.q } }, { domain: { contains: v.q.toLowerCase() } }, { mainProducts: { contains: v.q } }] });
  return and.length ? { AND: and } : {};
}

export async function listProspects(user: Actor, query: Record<string, string | undefined> = {}) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  const v = listQuery.parse(query);
  const since = await todayStart();
  const where = whereOf(v, since);
  const [rows, total, setting, today, unscored, byStatus] = await Promise.all([
    db.radarProspect.findMany({ where, include: { emails: true }, orderBy: [{ score: 'desc' }, { discoveredAt: 'desc' }, { id: 'asc' }],
      skip: (v.page - 1) * RADAR_PAGE_SIZE, take: RADAR_PAGE_SIZE }),
    db.radarProspect.count({ where }),
    db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } }),
    db.radarProspect.groupBy({ by: ['grade'], where: { discoveredAt: { gte: since }, status: { not: 'EXCLUDED' } }, _count: { _all: true } }),
    db.radarProspect.count({ where: { scoredAt: null, status: { in: [...OPEN_STATUSES] } } }),
    db.radarProspect.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const queue = await db.radarSend.count({ where: { status: { in: ['PREPARING', 'REVIEW', 'QUEUED', 'SENDING'] } } });
  const config = readRadarConfig(setting.radarConfig);
  const todayCount = (grade?: string) => today.filter(g => grade === undefined || g.grade === grade).reduce((sum, g) => sum + g._count._all, 0);
  return {
    query: v,
    total,
    pageSize: RADAR_PAGE_SIZE,
    countries: Object.fromEntries(Object.entries(config.countries).map(([code, c]) => [code, c.name])),
    summary: { todayNew: todayCount(), todayA: todayCount('A'), todayB: todayCount('B'), unscored, queue,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count._all])) as Partial<Record<ProspectStatus, number>> },
    health: { deepSeek: deepSeekConfigured(), verifier: verifierConfigured(), ingest: !!process.env.RADAR_INGEST_SECRET?.trim() },
    rows: rows.map(p => {
      const ranked = rankEmails(p.emails, p.domain);
      const facts = Array.isArray(p.siteFacts) ? p.siteFacts as { fact: string }[] : [];
      return {
        id: p.id, name: p.name, country: p.country, countryName: config.countries[p.country]?.name ?? p.country, city: p.city, timezone: p.timezone,
        website: p.website, domain: p.domain, phone: p.phone, whatsapp: p.whatsapp, mapsCategory: p.mapsCategory,
        rating: p.rating === null ? null : Number(p.rating), reviewCount: p.reviewCount,
        customerType: p.customerType, typeLabel: CUSTOMER_TYPES[p.customerType as keyof typeof CUSTOMER_TYPES] ?? '',
        mainProducts: p.mainProducts, aiReason: p.aiReason, fact: facts[0]?.fact ?? '', score: p.score, grade: p.grade,
        scoreParts: p.scoreParts as Record<string, number> | null, scoredAt: p.scoredAt && isoDay(p.scoredAt), scoreError: p.scoreError, scoreAttempts: p.scoreAttempts,
        email: ranked[0] ? { address: ranked[0].address, kind: ranked[0].kind, verifyStatus: ranked[0].verifyStatus, bounced: !!ranked[0].bouncedAt } : null,
        emailCount: p.emails.length, sendable: p.emails.some(sendable),
        status: p.status, statusLabel: PROSPECT_STATUSES[p.status as ProspectStatus] ?? p.status, excludedReason: p.excludedReason, notes: p.notes,
        keyword: p.keyword, discoveredAt: isoDay(p.discoveredAt), customerId: p.customerId,
      };
    }),
  };
}
export type RadarProspectRow = Awaited<ReturnType<typeof listProspects>>['rows'][number];

const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('exclude'), reason: z.string().trim().max(200, '原因最多 200 字').default('') }),
  z.object({ action: z.literal('restore') }),
  z.object({ action: z.literal('contacted'), note: z.string().trim().max(500, '说明最多 500 字').default('') }),
  z.object({ action: z.literal('rescore') }),
  z.object({ action: z.literal('notes'), notes: z.string().trim().max(1000, '备注最多 1000 字') }),
  z.object({ action: z.literal('erase') }),
], { errorMap: () => ({ message: '操作无效' }) });

/**
 * Forgets a company's contact details and every text about it. The addresses are blocked first (`reason`), so a
 * company that asked to be forgotten is never mailed again; the company row stays for the counts.
 */
export async function eraseProspectData(prospectId: string, client: Prisma.TransactionClient, reason: 'MANUAL' | 'UNSUBSCRIBE') {
  const emails = await client.radarEmail.findMany({ where: { prospectId } });
  for (const e of emails) {
    if (e.address.startsWith('erased-')) continue;
    await client.radarSuppression.upsert({ where: { scope_value_reason: { scope: 'EMAIL', value: e.address, reason } }, update: {},
      create: { scope: 'EMAIL', value: e.address, reason, note: reason === 'UNSUBSCRIBE' ? '对方要求删除数据' : '数据已按保留期限清理，保留禁发' } });
    await client.radarEmail.update({ where: { id: e.id }, data: { address: `erased-${e.id}@invalid`, foundOn: '', verifyDetail: '' } });
  }
  await client.radarSend.updateMany({ where: { prospectId }, data: { toAddress: 'erased@invalid', body: '', opening: '', subject: '' } });
  await client.radarReply.updateMany({ where: { prospectId }, data: { rawText: '', text: '', fromName: '', fromAddress: 'erased@invalid', subject: '', summary: '', extracted: Prisma.DbNull, aiRaw: Prisma.DbNull } });
  await client.radarProspect.update({ where: { id: prospectId }, data: { siteText: null, siteFacts: Prisma.DbNull, notes: '', whatsapp: '', socials: Prisma.DbNull } });
}

/** Statuses a person may move a prospect out of by hand; once mail is queued the queue decides. */
const HAND_STATUSES = ['NEW', 'NO_EMAIL', 'CONTACTED'];

/**
 * 排除 / 恢复 / 已联系 / 重新评分 / 备注. Each change is guarded by the status it expects, so a click on a stale card
 * (the scheduled job just moved it) gets a 409 instead of undoing the job's work.
 */
export async function updateProspect(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  z.string().trim().min(1).max(191).parse(id);
  const v = action.parse(input);
  const p = await db.radarProspect.findUnique({ where: { id }, include: { emails: true } });
  if (!p) throw new HttpError(404, '雷达客户不存在');
  const now = new Date();
  const guarded = async (from: string[], data: Prisma.RadarProspectUpdateManyMutationInput) => {
    const changed = await db.radarProspect.updateMany({ where: { id, status: { in: from } }, data });
    if (!changed.count) throw new HttpError(409, '这家客户的状态刚刚变了，请刷新后再操作');
  };
  if (v.action === 'exclude') {
    if (!HAND_STATUSES.includes(p.status)) throw new HttpError(409, `「${PROSPECT_STATUSES[p.status as ProspectStatus] ?? p.status}」的客户不能直接排除`);
    await guarded(HAND_STATUSES, { status: 'EXCLUDED', statusAt: now, excludedReason: v.reason || '手动排除' });
  } else if (v.action === 'restore') {
    if (p.status !== 'EXCLUDED') throw new HttpError(409, '只有已排除的客户可以恢复');
    if (p.excludedReason.startsWith('已在 BOS')) throw new HttpError(409, '这家公司已经在客户库里，不能恢复到雷达');
    await guarded(['EXCLUDED'], { status: mailability(p.emails) === 'NONE' ? 'NO_EMAIL' : 'NEW', statusAt: now, excludedReason: '' });
  } else if (v.action === 'contacted') {
    await guarded(['NEW', 'NO_EMAIL'], { status: 'CONTACTED', statusAt: now, ...(v.note ? { notes: [p.notes, v.note].filter(Boolean).join('\n').slice(0, 1000) } : {}) });
  } else if (v.action === 'erase') {
    // 对方要求删除数据: stop anything running, block the company, forget the details.
    await db.$transaction(async tx => {
      for (const seq of await tx.radarSequence.findMany({ where: { prospectId: id, status: { in: ['ACTIVE', 'PAUSED'] } }, select: { id: true } })) await stopSequence(tx, seq.id, 'STOPPED', 'ERASED', 'MANUAL');
      if (p.domain) await tx.radarSuppression.upsert({ where: { scope_value_reason: { scope: 'DOMAIN', value: p.domain, reason: 'UNSUBSCRIBE' } }, update: { expiresAt: null },
        create: { scope: 'DOMAIN', value: p.domain, reason: 'UNSUBSCRIBE', note: '对方要求删除数据', createdById: user.id } });
      await eraseProspectData(id, tx, 'UNSUBSCRIBE');
      await tx.radarProspect.update({ where: { id }, data: { status: p.customerId ? p.status : 'UNSUBSCRIBED', statusAt: now, excludedReason: '对方要求删除数据' } });
    });
  } else if (v.action === 'rescore') {
    await db.radarProspect.update({ where: { id }, data: { scoredAt: null, scoreAttempts: 0, scoreError: '' } });
  } else {
    await db.radarProspect.update({ where: { id }, data: { notes: v.notes } });
  }
  return { id };
}
