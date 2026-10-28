import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { retryTransaction } from '@/lib/transaction-retry';
import { afterResponse } from '@/lib/after-response';
import { emailDomain, isFreeMail, rankEmails, readRadarConfig, sendable, type RadarConfig } from '@/lib/radar';
import { DAY_MS, localParts, planQueue, type QueueItem } from '@/lib/radar-schedule';
import { greetingFor, renderTemplate, type MailLanguage } from '@/lib/radar-mail';
import { deepSeekConfigured } from './deepseek-customer-service';
import { writeOpening } from './radar-ai-service';
import { findBosCustomer } from './radar-bos-service';
import { mailboxStates, todayStart } from './radar-mailbox-service';
import { suppressionFor } from './radar-suppression-service';
import { pickTemplate } from './radar-template-service';

/**
 * 发送队列 (docs/CUSTOMER_RADAR_COLD_EMAIL.md §6, §7.1). An administrator confirms 「加入发送队列」: that click is the
 * human send of the sequence's fixed templates (PROJECT_RULES §0.5.4) and is recorded on the sequence. Anything the
 * AI wrote waits in 待审核 until a person approves it; the queue only decides when each mail leaves.
 */

export const SEND_STATUSES = {
  PREPARING: '准备中', REVIEW: '待审核', QUEUED: '排队中', SCHEDULED: '已安排', SENDING: '发送中', SENT: '已发送', BOUNCED: '退信',
  CANCELLED: '已取消', FAILED: '失败', UNKNOWN: '状态不明',
} as const;
export const CANCEL_REASONS = { SUPPRESSED: '在禁发名单', REPLIED: '客户已回复', IN_BOS: '已在 BOS 跟进', SEQUENCE_STOPPED: '序列已停止', MANUAL: '人工取消', ADDRESS_INVALID: '地址无效' } as const;
export const SKIP_REASONS = {
  NOT_OPEN: '不在待处理状态', UNSCORED: '还没评分', C_GRADE: 'C 级默认不发', NOT_VERIFIED: '邮箱还没验证', NO_EMAIL: '没有可用邮箱',
  SUPPRESSED: '在禁发名单', IN_SEQUENCE: '已在跟进中', IN_BOS: '已在 BOS', NO_TEMPLATE: '没有可用的第 1 封模板', NO_CATALOG: '模板用了目录链接，但设置里还没填',
} as const;
type SkipReason = keyof typeof SKIP_REASONS;
const ACTIVE_SENDS = ['PREPARING', 'REVIEW', 'QUEUED', 'SENDING', 'UNKNOWN'];

const enqueueInput = z.object({
  ids: z.array(z.string().trim().min(1).max(191)).max(200, '一次最多选 200 家').default([]),
  preset: z.enum(['TODAY_A']).nullable().default(null),
  language: z.enum(['auto', 'fr', 'en']).default('auto'),
  review: z.boolean().default(true),
}).refine(v => v.ids.length > 0 || v.preset, { message: '请先选择客户' });

async function radarSetting() {
  const s = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true, radarPausedAt: true, radarLaunchedAt: true, timezone: true } });
  return { ...s, config: readRadarConfig(s.radarConfig) };
}
/** Until strictReviewDays after the first mail went out, every first mail is reviewed as a whole. */
export const strictReview = (launchedAt: Date | null, config: RadarConfig, now = new Date()) =>
  !launchedAt || now.getTime() < launchedAt.getTime() + config.strictReviewDays * DAY_MS;
/** One running sequence per company: its domain, else the address's own domain, else the prospect itself. */
export const lockKey = (p: { id: string; domain: string }, address: string) => (p.domain || (!isFreeMail(emailDomain(address)) ? emailDomain(address) : `prospect:${p.id}`)).slice(0, 191);
const languageOf = (country: string, config: RadarConfig, wanted: 'auto' | 'fr' | 'en'): MailLanguage => wanted === 'auto' ? (config.countries[country]?.language ?? 'en') : wanted;

type Candidate = { prospect: Prisma.RadarProspectGetPayload<{ include: { emails: true } }>; email?: { id: string; address: string; verifyStatus: string }; language: MailLanguage; reason?: SkipReason };

/** Every selected prospect with the address it would be mailed at, or why it is skipped. Reads only. */
async function candidates(v: z.infer<typeof enqueueInput>, config: RadarConfig) {
  const where: Prisma.RadarProspectWhereInput = v.preset === 'TODAY_A'
    ? { status: 'NEW', grade: 'A', discoveredAt: { gte: (await todayStart()).start }, emails: { some: { bouncedAt: null, verifyStatus: { in: ['VALID', 'RISKY'] } } } }
    : { id: { in: [...new Set(v.ids)] } };
  const prospects = await db.radarProspect.findMany({ where, include: { emails: true }, orderBy: [{ score: 'desc' }, { id: 'asc' }], take: 200 });
  const variant = config.fairInvitation ? 'FAIR' : 'STANDARD';
  const languageReason = new Map<MailLanguage, SkipReason | null>();
  for (const language of ['fr', 'en'] as const) {
    const template = await pickTemplate(db, language, 1, variant);
    const needsCatalog = template && (await db.radarTemplate.count({ where: { language, step: { in: [1, 2, 3] }, status: { in: ['TESTING', 'WINNER'] }, body: { contains: '{目录链接}' } } })) > 0;
    languageReason.set(language, !template ? 'NO_TEMPLATE' : needsCatalog && !config.catalogUrls[language] ? 'NO_CATALOG' : null);
  }
  const out: Candidate[] = [];
  for (const p of prospects) {
    const language = languageOf(p.country, config, v.language);
    const email = rankEmails(p.emails.filter(sendable), p.domain)[0];
    const reason: SkipReason | null =
      p.status !== 'NEW' ? (['QUEUED', 'IN_SEQUENCE'].includes(p.status) ? 'IN_SEQUENCE' : 'NOT_OPEN')
        : !p.grade ? 'UNSCORED' : p.grade === 'C' ? 'C_GRADE'
          : !email ? (p.emails.some(e => !e.bouncedAt && (e.verifyStatus === '' || e.verifyStatus === 'UNKNOWN')) ? 'NOT_VERIFIED' : 'NO_EMAIL')
            : languageReason.get(language) ?? null;
    if (reason || !email) { out.push({ prospect: p, language, reason: reason ?? 'NO_EMAIL' }); continue; }
    if (await suppressionFor(db, email.address, [p.domain].filter(Boolean))) { out.push({ prospect: p, language, reason: 'SUPPRESSED' }); continue; }
    if (await db.radarSequence.findUnique({ where: { activeDomain: lockKey(p, email.address) } })) { out.push({ prospect: p, language, reason: 'IN_SEQUENCE' }); continue; }
    if (await findBosCustomer({ emails: [email.address], phones: [p.phoneE164, p.whatsapp].filter((x): x is string => !!x), domain: p.domain })) { out.push({ prospect: p, language, reason: 'IN_BOS' }); continue; }
    out.push({ prospect: p, language, email });
  }
  return out;
}

/** The queue as the planner sees it: mails waiting to go, with the recipient's calendar. */
async function waitingItems(config: RadarConfig, statuses = ['QUEUED']): Promise<(QueueItem & { prospectId: string })[]> {
  const sends = await db.radarSend.findMany({ where: { status: { in: statuses } }, include: { prospect: { select: { timezone: true, country: true } }, sequence: { select: { mailboxId: true } } }, take: 3000 });
  return sends.filter(s => config.countries[s.prospect.country]).map(s => ({
    id: s.id, prospectId: s.prospectId, step: s.step, dueAt: s.nextAttemptAt && s.nextAttemptAt > s.dueAt ? s.nextAttemptAt : s.dueAt, pinnedAt: s.pinnedAt,
    grade: s.grade, score: s.score, createdAt: s.createdAt, risky: s.risky, timezone: s.prospect.timezone, country: config.countries[s.prospect.country], mailboxId: s.sequence.mailboxId,
  }));
}

async function plan(config: RadarConfig, extra: QueueItem[] = [], now = new Date()) {
  const [{ boxes, timezone }, items] = await Promise.all([mailboxStates(now), waitingItems(config, ['QUEUED', 'REVIEW', 'PREPARING'])]);
  const mailboxes = boxes.filter(b => b.connected && b.box.status === 'ACTIVE').map(b => ({ id: b.box.id, cap: b.cap, sentToday: b.sentToday, riskyToday: b.riskyToday, nextSendAt: b.box.nextSendAt }));
  return { mailboxes, timezone, plan: planQueue({ now, items: [...items, ...extra], mailboxes, config, dayTz: timezone }) };
}

/** 加入队列确认框: how many go, how many are skipped and why, which language, when the queue would be done. */
export async function previewEnqueue(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  const v = enqueueInput.parse(input);
  const s = await radarSetting();
  const list = await candidates(v, s.config);
  const ready = list.filter(c => !c.reason);
  const now = new Date();
  const extra: QueueItem[] = ready.map(c => ({ id: `new:${c.prospect.id}`, step: 1, dueAt: now, pinnedAt: null, grade: c.prospect.grade, score: c.prospect.score ?? 0, createdAt: now,
    risky: c.email!.verifyStatus === 'RISKY', timezone: c.prospect.timezone, country: s.config.countries[c.prospect.country], mailboxId: null })).filter(i => i.country);
  const { plan: planned, mailboxes, timezone } = await plan(s.config, extra, now);
  const times = extra.map(i => planned.get(i.id)?.at).filter((t): t is Date => !!t);
  const last = times.length === extra.length && times.length ? times.reduce((a, b) => (b > a ? b : a)) : null;
  const lastItem = last ? extra.find(i => planned.get(i.id)?.at.getTime() === last.getTime()) : null;
  const skipped = Object.entries(list.filter(c => c.reason).reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.reason!]: (acc[c.reason!] ?? 0) + 1 }), {}))
    .map(([reason, count]) => ({ reason, label: SKIP_REASONS[reason as SkipReason], count }));
  const strict = strictReview(s.radarLaunchedAt, s.config, now);
  return {
    selected: list.length, ready: ready.length, skipped,
    languages: { fr: ready.filter(c => c.language === 'fr').length, en: ready.filter(c => c.language === 'en').length },
    review: { forced: strict, default: strict, aiAlways: true },
    mailboxes: mailboxes.length, dailyCapacity: mailboxes.reduce((sum, m) => sum + m.cap, 0),
    estimate: last && lastItem ? { finishAt: last, recipientTimezone: lastItem.timezone, companyTimezone: timezone } : null,
    unplanned: extra.length - times.length,
  };
}

const renderValues = (p: { name: string; city: string }, language: MailLanguage, opening: string, config: RadarConfig) =>
  ({ greeting: greetingFor(language), company: p.name, city: p.city, opening, catalogUrl: config.catalogUrls[language] });

/** 加入发送队列: one sequence and its first mail per company. Checks again rather than trusting the preview. */
export async function enqueueProspects(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  const v = enqueueInput.parse(input);
  const s = await radarSetting();
  const list = await candidates(v, s.config);
  const needsReview = v.review || strictReview(s.radarLaunchedAt, s.config);
  const variant = s.config.fairInvitation ? 'FAIR' : 'STANDARD';
  let queued = 0, preparing = 0;
  const skipped: Record<string, number> = {};
  const skip = (reason: SkipReason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  for (const c of list) {
    if (c.reason || !c.email) { skip(c.reason ?? 'NO_EMAIL'); continue; }
    const p = c.prospect, email = c.email;
    const facts = Array.isArray(p.siteFacts) ? p.siteFacts as { fact: string; quote: string }[] : [];
    const aiOpening = facts.length > 0 && deepSeekConfigured();
    try {
      await retryTransaction(() => db.$transaction(async tx => {
        const moved = await tx.radarProspect.updateMany({ where: { id: p.id, status: 'NEW' }, data: { status: 'QUEUED', statusAt: new Date() } });
        if (!moved.count) throw new HttpError(409, 'IN_SEQUENCE');
        const sequence = await tx.radarSequence.create({ data: { prospectId: p.id, emailId: email.id, language: c.language, variant, activeDomain: lockKey(p, email.address), needsReview, enqueuedById: user.id } });
        const template = await pickTemplate(tx, c.language, 1, variant);
        if (!template) throw new HttpError(409, 'NO_TEMPLATE');
        const values = renderValues(p, c.language, '', s.config);
        await tx.radarSend.create({ data: {
          sequenceId: sequence.id, step: 1, prospectId: p.id, emailId: email.id, toAddress: email.address, templateId: template.id, templateCode: template.code,
          subject: renderTemplate(template.subject, values).slice(0, 300), body: aiOpening ? '' : renderTemplate(template.body, values),
          openingSource: aiOpening ? '' : 'NONE', status: aiOpening ? 'PREPARING' : needsReview ? 'REVIEW' : 'QUEUED',
          dueAt: new Date(), grade: p.grade, score: p.score ?? 0, risky: email.verifyStatus === 'RISKY',
        } });
      }));
      if (aiOpening) preparing++; else queued++;
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) { skip(error.message === 'NO_TEMPLATE' ? 'NO_TEMPLATE' : 'IN_SEQUENCE'); continue; }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') { skip('IN_SEQUENCE'); continue; }
      throw error;
    }
  }
  // Openings are written right after the answer; the scheduled job picks up whatever is left.
  if (preparing) afterResponse(() => prepareOpenings(20));
  return { queued: queued + preparing, preparing, skipped: Object.entries(skipped).map(([reason, count]) => ({ reason, label: SKIP_REASONS[reason as SkipReason], count })) };
}

const STALE_CLAIM_MS = 5 * 60_000;
/**
 * Writes the personalised opening of first mails waiting for one. The model only sees the facts quoted from the
 * company's site; its sentence is checked by rules and then always waits for a person in 待审核. Without DeepSeek,
 * facts or a usable sentence, the mail uses the version without an opening.
 */
export async function prepareOpenings(limit = 5) {
  const s = await radarSetting();
  const rows = await db.radarSend.findMany({ where: { status: 'PREPARING', OR: [{ openingSource: '' }, { openingSource: 'PENDING', updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } }] },
    include: { prospect: true, template: true, sequence: { select: { needsReview: true, language: true } } }, orderBy: { createdAt: 'asc' }, take: limit });
  let written = 0, without = 0;
  for (const send of rows) {
    const claim = await db.radarSend.updateMany({ where: { id: send.id, status: 'PREPARING', openingSource: send.openingSource }, data: { openingSource: 'PENDING' } });
    if (!claim.count) continue;
    const language = send.sequence.language as MailLanguage;
    const facts = Array.isArray(send.prospect.siteFacts) ? send.prospect.siteFacts as { fact: string; quote: string }[] : [];
    let opening = '';
    if (facts.length && deepSeekConfigured()) {
      try { opening = await writeOpening({ language, company: send.prospect.name, city: send.prospect.city, mainProducts: send.prospect.mainProducts, facts }); }
      catch (error) { console.warn('[radar] opening failed', { sendId: send.id, error: error instanceof Error ? error.message : 'unknown' }); }
    }
    const values = renderValues(send.prospect, language, opening, s.config);
    const body = send.template ? renderTemplate(send.template.body, values) : send.body;
    await db.radarSend.updateMany({ where: { id: send.id, status: 'PREPARING' }, data: {
      opening, openingSource: opening ? 'AI' : 'NONE', body,
      status: opening || send.sequence.needsReview ? 'REVIEW' : 'QUEUED',
    } });
    if (opening) written++; else without++;
  }
  return { written, without };
}

// ─── Queue page ─────────────────────────────────────────

const VIEWS = { ACTIVE: ACTIVE_SENDS, SENT: ['SENT', 'BOUNCED'], PROBLEM: ['FAILED', 'UNKNOWN'], CANCELLED: ['CANCELLED'] } as const;
const viewQuery = z.object({ view: z.enum(['ACTIVE', 'SENT', 'PROBLEM', 'CANCELLED']).catch('ACTIVE').default('ACTIVE') });

export async function queueView(user: Actor, query: Record<string, string | undefined> = {}) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  const { view } = viewQuery.parse(query);
  const s = await radarSetting();
  const now = new Date();
  const [{ plan: planned, timezone }, states, rows, counts] = await Promise.all([
    plan(s.config, [], now),
    mailboxStates(now),
    db.radarSend.findMany({ where: { status: { in: [...VIEWS[view]] }, ...(view === 'ACTIVE' ? {} : { updatedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } }) },
      include: { prospect: { select: { id: true, name: true, country: true, city: true, timezone: true } }, mailbox: { select: { address: true } } },
      orderBy: view === 'ACTIVE' ? [{ createdAt: 'asc' }] : [{ updatedAt: 'desc' }], take: 300 }),
    db.radarSend.groupBy({ by: ['status'], where: { OR: [{ status: { in: ACTIVE_SENDS } }, { updatedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } }] }, _count: { _all: true } }),
  ]);
  const today = localParts(now, timezone).day;
  const sentToday = states.boxes.reduce((sum, b) => sum + b.sentToday, 0);
  const plannedToday = [...planned.values()].filter(p => localParts(p.at, timezone).day === today).length;
  // Unknown outcomes first (someone must check the sent folder), then mails waiting for review, then by planned time.
  const rank = (status: string) => status === 'UNKNOWN' ? 0 : status === 'REVIEW' ? 1 : status === 'PREPARING' ? 2 : 3;
  const list = rows.map(r => {
    const p = planned.get(r.id);
    return {
      rank: rank(r.status),
      id: r.id, step: r.step, status: r.status, statusLabel: SEND_STATUSES[r.status as keyof typeof SEND_STATUSES] ?? r.status,
      scheduledToday: !!p && localParts(p.at, timezone).day === today, plannedAt: p?.at ?? null, plannedMailbox: p ? states.boxes.find(b => b.box.id === p.mailboxId)?.box.address ?? '' : '',
      prospect: { ...r.prospect, countryName: s.config.countries[r.prospect.country]?.name ?? r.prospect.country },
      toAddress: r.toAddress, templateCode: r.templateCode, subject: r.subject, body: r.body, opening: r.opening, openingSource: r.openingSource, edited: r.edited,
      mailbox: r.mailbox?.address ?? '', pinned: !!r.pinnedAt, risky: r.risky, dueAt: r.dueAt, sentAt: r.sentAt, attempts: r.attempts, lastError: r.lastError,
      cancelReason: r.cancelReason, cancelLabel: CANCEL_REASONS[r.cancelReason as keyof typeof CANCEL_REASONS] ?? r.cancelReason, updatedAt: r.updatedAt,
    };
  }).sort((a, b) => view !== 'ACTIVE' ? 0 : a.rank - b.rank || (a.plannedAt?.getTime() ?? Infinity) - (b.plannedAt?.getTime() ?? Infinity));
  return {
    view, paused: !!s.radarPausedAt, pausedAt: s.radarPausedAt, sendingEnabled: process.env.RADAR_SEND_ENABLED === 'true',
    strictReview: strictReview(s.radarLaunchedAt, s.config, now), companyTimezone: timezone,
    today: { sent: sentToday, planned: sentToday + plannedToday },
    counts: Object.fromEntries(counts.map(c => [c.status, c._count._all])) as Record<string, number>,
    mailboxes: states.boxes.map(b => ({ id: b.box.id, address: b.box.address, status: b.box.status, pausedReason: b.box.pausedReason, connected: b.connected,
      cap: b.cap, sentToday: b.sentToday, week: b.week, nextSendAt: b.box.nextSendAt })),
    rows: list,
  };
}

const sendAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('edit'), opening: z.string().trim().max(500, '开头最多 500 字').optional(), subject: z.string().trim().min(1, '主题不能为空').max(300).optional(),
    body: z.string().trim().min(1, '正文不能为空').max(8000).optional() }),
  z.object({ action: z.literal('pin') }),
  z.object({ action: z.literal('unpin') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('confirmSent') }),
  z.object({ action: z.literal('confirmNotSent') }),
], { errorMap: () => ({ message: '操作无效' }) });

const unfilled = (text: string) => /\{[^{}\n]{1,20}\}/.test(text);

/**
 * Ends a sequence: no further mail, the domain is free again. The prospect goes back to the wall when nothing went out
 * yet, otherwise it counts as contacted without a reply.
 */
export async function stopSequence(tx: Prisma.TransactionClient, sequenceId: string, status: 'STOPPED' | 'BOUNCED' | 'ENDED' | 'REPLIED', reason: string, cancel: keyof typeof CANCEL_REASONS) {
  const sequence = await tx.radarSequence.update({ where: { id: sequenceId }, data: { status, activeDomain: null, endedAt: new Date(), endReason: reason.slice(0, 32) } });
  await tx.radarSend.updateMany({ where: { sequenceId, status: { in: ['PREPARING', 'REVIEW', 'QUEUED', 'SCHEDULED'] } }, data: { status: 'CANCELLED', cancelReason: cancel } });
  return sequence;
}

export async function updateSend(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  z.string().trim().min(1).max(191).parse(id);
  const v = sendAction.parse(input);
  const send = await db.radarSend.findUnique({ where: { id }, include: { prospect: true, template: true, sequence: true } });
  if (!send) throw new HttpError(404, '这封信不存在');
  const guarded = async (from: string[], data: Prisma.RadarSendUncheckedUpdateManyInput) => {
    const changed = await db.radarSend.updateMany({ where: { id, status: { in: from } }, data });
    if (!changed.count) throw new HttpError(409, '这封信的状态刚刚变了，请刷新后再操作');
  };
  if (v.action === 'approve') {
    if (unfilled(send.subject) || unfilled(send.body)) throw new HttpError(409, '主题或正文里还有没填的变量，请先修改');
    await guarded(['REVIEW'], { status: 'QUEUED', approvedById: user.id, approvedAt: new Date() });
  } else if (v.action === 'edit') {
    if (!['REVIEW', 'QUEUED'].includes(send.status)) throw new HttpError(409, '只有待审核或排队中的信可以修改');
    if (v.subject !== undefined && send.step > 1) throw new HttpError(409, '第 2、3 封在同一线程里回复，主题不能改');
    const s = await radarSetting();
    const opening = v.opening ?? send.opening;
    const openingChanged = v.opening !== undefined && v.opening !== send.opening;
    const body = v.body ?? (openingChanged && send.template && !send.edited ? renderTemplate(send.template.body, renderValues(send.prospect, send.sequence.language as MailLanguage, opening, s.config)) : send.body);
    await guarded(['REVIEW', 'QUEUED'], {
      ...(openingChanged ? { opening, openingSource: opening ? 'HUMAN' : 'NONE' } : {}),
      ...(v.subject !== undefined ? { subject: v.subject } : {}),
      body, ...(v.body !== undefined && v.body !== send.body ? { edited: true } : {}),
    });
  } else if (v.action === 'pin' || v.action === 'unpin') {
    await guarded(['PREPARING', 'REVIEW', 'QUEUED'], { pinnedAt: v.action === 'pin' ? new Date() : null });
  } else if (v.action === 'cancel') {
    if (!['PREPARING', 'REVIEW', 'QUEUED', 'FAILED'].includes(send.status)) throw new HttpError(409, '这封信已经发出或正在发送，不能取消');
    await retryTransaction(() => db.$transaction(async tx => {
      const changed = await tx.radarSend.updateMany({ where: { id, status: send.status }, data: { status: 'CANCELLED', cancelReason: 'MANUAL' } });
      if (!changed.count) throw new HttpError(409, '这封信的状态刚刚变了，请刷新后再操作');
      if (send.sequence.status === 'ACTIVE' || send.sequence.status === 'PAUSED') await stopSequence(tx, send.sequenceId, 'STOPPED', 'MANUAL', 'MANUAL');
      const anySent = await tx.radarSend.count({ where: { sequenceId: send.sequenceId, status: { in: ['SENT', 'BOUNCED'] } } });
      await tx.radarProspect.updateMany({ where: { id: send.prospectId, status: { in: ['QUEUED', 'IN_SEQUENCE'] } }, data: { status: anySent ? 'NO_REPLY' : 'NEW', statusAt: new Date() } });
    }));
  } else if (v.action === 'confirmSent') {
    await guarded(['UNKNOWN'], { status: 'SENT', sentAt: send.updatedAt, lastError: '人工确认已发出' });
  } else {
    await guarded(['UNKNOWN'], { status: 'QUEUED', mailboxId: null, lastError: '人工确认未发出，重新排队' });
  }
  return { id };
}

const approveInput = z.object({ ids: z.array(z.string().trim().min(1).max(191)).min(1, '请先选择要通过的信').max(200) });
/** 批量通过: every selected mail still waiting for review whose variables are all filled. */
export async function approveSends(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  const { ids } = approveInput.parse(input);
  const rows = await db.radarSend.findMany({ where: { id: { in: ids }, status: 'REVIEW' }, select: { id: true, subject: true, body: true } });
  const ok = rows.filter(r => !unfilled(r.subject) && !unfilled(r.body)).map(r => r.id);
  const changed = await db.radarSend.updateMany({ where: { id: { in: ok }, status: 'REVIEW' }, data: { status: 'QUEUED', approvedById: user.id, approvedAt: new Date() } });
  return { approved: changed.count, skipped: ids.length - changed.count };
}

export async function setSendingPaused(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以暂停发送');
  const { paused } = z.object({ paused: z.boolean() }).parse(input);
  await db.setting.update({ where: { id: 'system' }, data: { radarPausedAt: paused ? new Date() : null } });
  return { paused };
}

/** 待审核的信 for the review page: AI openings and whole first mails waiting for a person. */
export async function reviewSends(user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  const s = await radarSetting();
  const rows = await db.radarSend.findMany({ where: { status: 'REVIEW' }, include: { prospect: { select: { id: true, name: true, country: true, city: true, mainProducts: true, siteFacts: true, website: true } },
    sequence: { select: { language: true, needsReview: true } } }, orderBy: { createdAt: 'asc' }, take: 200 });
  return rows.map(r => ({ id: r.id, step: r.step, templateCode: r.templateCode, toAddress: r.toAddress, subject: r.subject, body: r.body, opening: r.opening, openingSource: r.openingSource,
    language: r.sequence.language, wholeMail: r.sequence.needsReview, createdAt: r.createdAt, updatedAt: r.updatedAt,
    prospect: { ...r.prospect, countryName: s.config.countries[r.prospect.country]?.name ?? r.prospect.country, facts: Array.isArray(r.prospect.siteFacts) ? r.prospect.siteFacts as { fact: string; quote: string }[] : [] } }));
}
