import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { dayKey, localDate } from '@/lib/time';
import { ADVANCED_STAGES } from '@/lib/constants';
import { SUGGESTIONS, judgeArms, percent } from '@/lib/outreach';
import { readRadarConfig } from '@/lib/radar';
import { GmailError, accessToken, gmailConfigured, postmasterSpamRatio } from '@/lib/gmail';
import { openSecret } from '@/lib/secret';
import { LANGUAGE_LABELS, type MailLanguage } from '@/lib/radar-mail';
import { REPLY_CATEGORIES, VALID_CATEGORIES, type ReplyCategory } from '@/lib/radar-reply';
import { claimOnce } from './boss-brief-service';
import { pauseMailbox } from './radar-mailbox-service';
import { notifyAdmins } from './radar-notify-service';
import { eraseProspectData } from './radar-prospect-service';

/**
 * 开发信效果 (docs/CUSTOMER_RADAR_COLD_EMAIL.md §6, docs/METRICS.md「客户雷达」): the three weekly numbers — bounce rate,
 * reply rate, valid replies — with the rest of the measure table, template versions compared with the same Beta rule as
 * the WhatsApp scripts, and the weekly check of the AI's reading. Unknown values stay null and show as "—".
 */

const DAY = 24 * 3600_000;
/** Gmail's sender guidelines: keep spam reports under 0.1%, never reach 0.3%. */
const SPAM_WARN = 0.001, SPAM_PAUSE = 0.003;
const POSTMASTER_KEY = 'radar-postmaster:';
const NOT_HUMAN = ['AUTO_REPLY', 'BOUNCE'];
/** A reply from a person: not a bounce or an auto-reply, whether or not it has been read yet. */
const humanReply = { screen: 'NONE', category: { notIn: NOT_HUMAN } } satisfies Prisma.RadarReplyWhereInput;

/** Monday 00:00 (company time) of the week containing `at`, and the next one. */
function weekOf(at: Date, timezone: string) {
  const day = dayKey(at, timezone);
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = new Date(Date.parse(`${day}T12:00:00Z`) - weekday * DAY).toISOString().slice(0, 10);
  const start = localDate(`${monday}T00:00:00`, timezone);
  return { key: monday, start, end: new Date(start.getTime() + 7 * DAY) };
}

/** The measure table for one period. */
async function measures(start: Date, end: Date) {
  const sentIn = { sentAt: { gte: start, lt: end } };
  const [found, foundMailable, sent, bounced, sequences, replies, valid, complaints] = await Promise.all([
    db.radarProspect.count({ where: { discoveredAt: { gte: start, lt: end }, grade: { in: ['A', 'B'] } } }),
    db.radarProspect.count({ where: { discoveredAt: { gte: start, lt: end }, grade: { in: ['A', 'B'] }, emails: { some: { bouncedAt: null, verifyStatus: { in: ['VALID', 'RISKY'] } } } } }),
    db.radarSend.count({ where: { status: { in: ['SENT', 'BOUNCED'] }, ...sentIn } }),
    db.radarSend.count({ where: { status: 'BOUNCED', ...sentIn } }),
    // Companies first mailed in the period, unless that first mail only bounced.
    db.radarSequence.findMany({ where: { sends: { some: { step: 1, status: 'SENT', ...sentIn } } }, select: { id: true, prospectId: true } }),
    db.radarReply.count({ where: { ...humanReply, receivedAt: { gte: start, lt: end } } }),
    db.radarReply.count({ where: { category: { in: [...VALID_CATEGORIES] }, receivedAt: { gte: start, lt: end } } }),
    db.radarReply.count({ where: { complaint: true, receivedAt: { gte: start, lt: end } } }),
  ]);
  const mailed = new Set(sequences.map(s => s.prospectId)).size;
  const answered = new Set((await db.radarReply.findMany({ where: { ...humanReply, sequenceId: { in: sequences.map(s => s.id) } }, select: { prospectId: true } })).map(r => r.prospectId)).size;
  return {
    found, mailableRate: percent(foundMailable, found), sent, bounced, bounceRate: percent(bounced, sent),
    mailed, answered, replyRate: percent(answered, mailed), replies, valid, complaints, complaintRate: percent(complaints, sent),
  };
}

/** Template versions of the same language and step, compared on delivered mails (edited ones left out). */
async function templateComparison(config: ReturnType<typeof readRadarConfig>) {
  const templates = await db.radarTemplate.findMany({ orderBy: [{ language: 'asc' }, { step: 'asc' }, { code: 'asc' }] });
  const delivered = await db.radarSend.groupBy({ by: ['templateId'], where: { status: 'SENT', edited: false, templateId: { not: null } }, _count: { _all: true } });
  const bounced = await db.radarSend.groupBy({ by: ['templateId'], where: { status: 'BOUNCED', edited: false, templateId: { not: null } }, _count: { _all: true } });
  const answered = await db.radarSend.findMany({ where: { status: 'SENT', edited: false, templateId: { not: null }, replies: { some: humanReply } },
    select: { templateId: true, replies: { where: humanReply, select: { category: true } } } });
  const count = (rows: { templateId: string | null; _count: { _all: number } }[], id: string) => rows.find(r => r.templateId === id)?._count._all ?? 0;
  const groups = new Map<string, typeof templates>();
  for (const t of templates) groups.set(`${t.language}-${t.step}`, [...(groups.get(`${t.language}-${t.step}`) ?? []), t]);
  return [...groups.entries()].map(([key, list]) => {
    const arms = list.map(t => {
      const replies = answered.filter(a => a.templateId === t.id);
      return { template: t, sent: count(delivered, t.id), bounced: count(bounced, t.id), replied: replies.length,
        valid: replies.filter(r => r.replies.some(x => (VALID_CATEGORIES as readonly string[]).includes(x.category))).length };
    });
    const judged = judgeArms(arms.map(a => ({ replied: a.replied, sent: a.sent })), config);
    const [language, step] = key.split('-');
    return { language, languageLabel: LANGUAGE_LABELS[language as MailLanguage] ?? language, step: Number(step), rows: arms.map((a, i) => ({
      id: a.template.id, code: a.template.code, status: a.template.status, variant: a.template.variant, sent: a.sent, bounced: a.bounced, replied: a.replied, valid: a.valid,
      replyRate: percent(a.replied, a.sent), validRate: percent(a.valid, a.sent), probability: judged[i].probability,
      suggestion: judged[i].suggestion, suggestionLabel: SUGGESTIONS[judged[i].suggestion],
    })) };
  });
}

/** Up to 20 replies the AI read in the last seven days, half judged valid and half not, for a person to check. */
async function sampleSet(now: Date) {
  const since = new Date(now.getTime() - 7 * DAY);
  const pick = (validOnes: boolean) => db.radarReply.findMany({ where: { analyzedAt: { gte: since }, aiCategory: validOnes ? { in: [...VALID_CATEGORIES] } : { notIn: [...VALID_CATEGORIES, ''] } },
    orderBy: [{ sampledAt: 'asc' }, { receivedAt: 'desc' }], take: 10, include: { prospect: { select: { name: true } } } });
  const rows = [...await pick(true), ...await pick(false)];
  return rows.map(r => ({ id: r.id, prospect: r.prospect.name, fromAddress: r.fromAddress, receivedAt: r.receivedAt, text: r.text.slice(0, 1200), summary: r.summary,
    aiCategory: r.aiCategory, aiLabel: REPLY_CATEGORIES[r.aiCategory as ReplyCategory] ?? r.aiCategory, category: r.category, confidence: r.confidence === null ? null : Number(r.confidence),
    sampleVerdict: r.sampleVerdict, sampledAt: r.sampledAt }));
}

type SpamReading = { domain: string; day: string | null; ratio: number | null; note: string };

/** The most recent daily Postmaster reading, or null before the first one. */
async function latestPostmaster() {
  const row = await db.dailyAdInsight.findFirst({ where: { reportKey: { startsWith: POSTMASTER_KEY } }, orderBy: { reportDate: 'desc' }, select: { reportDate: true, evidence: true } });
  if (!row) return null;
  const readings = ((row.evidence as { readings?: SpamReading[] }).readings ?? [])
    .map(r => ({ ...r, percent: r.ratio === null ? null : Math.round(r.ratio * 10_000) / 100 }));
  return { checkedOn: row.reportDate.toISOString().slice(0, 10), readings };
}

export async function radarStats(user: Actor, now = new Date()) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, radarConfig: true, radarLaunchedAt: true } });
  const config = readRadarConfig(setting.radarConfig);
  const current = weekOf(now, setting.timezone);
  const weeks = await Promise.all(Array.from({ length: 8 }, (_, i) => {
    const start = new Date(current.start.getTime() - i * 7 * DAY);
    return measures(start, new Date(start.getTime() + 7 * DAY)).then(m => ({ week: dayKey(start, setting.timezone), ...m }));
  }));
  const radarCustomers = await db.radarReply.findMany({ where: { pushStatus: 'PUSHED', customerId: { not: null } }, distinct: ['customerId'], select: { customerId: true } });
  const ids = radarCustomers.map(r => r.customerId!);
  const [advanced, categories, sampled, reviewed] = await Promise.all([
    db.customer.count({ where: { id: { in: ids }, deletedAt: null, OR: [{ stage: { in: [...ADVANCED_STAGES] } }, { quotedAt: { not: null } }] } }),
    db.radarReply.groupBy({ by: ['category'], where: { receivedAt: { gte: new Date(now.getTime() - 28 * DAY) }, category: { not: '' } }, _count: { _all: true } }),
    db.radarReply.groupBy({ by: ['sampleVerdict'], where: { sampledAt: { gte: current.start } }, _count: { _all: true } }),
    db.radarReply.groupBy({ by: ['reviewStatus'], where: { reviewedAt: { gte: new Date(now.getTime() - 28 * DAY) } }, _count: { _all: true } }),
  ]);
  const verdict = (v: string) => sampled.find(s => s.sampleVerdict === v)?._count._all ?? 0;
  const checked = verdict('CORRECT') + verdict('WRONG');
  return {
    week: current.key, launchedAt: setting.radarLaunchedAt, minSample: config.minSample, weeks,
    funnel: { pushed: ids.length, advanced },
    categories: categories.map(c => ({ category: c.category, label: REPLY_CATEGORIES[c.category as ReplyCategory] ?? c.category, count: c._count._all })).sort((a, b) => b.count - a.count),
    templates: await templateComparison(config),
    ai: { checked, correct: verdict('CORRECT'), accuracy: percent(verdict('CORRECT'), checked),
      reviewedConfirmed: reviewed.find(r => r.reviewStatus === 'CONFIRMED')?._count._all ?? 0, reviewedCorrected: reviewed.find(r => r.reviewStatus === 'CORRECTED')?._count._all ?? 0 },
    samples: await sampleSet(now),
    postmaster: await latestPostmaster(),
  };
}

const sampleInput = z.object({ verdict: z.enum(['CORRECT', 'WRONG'], { errorMap: () => ({ message: '请选择 AI 判对了还是判错了' }) }) });
/** 每周抽查: a person says whether the AI's reading of a reply was right. Wrong valid/invalid calls are fixed in 待复核. */
export async function sampleReply(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  z.string().trim().min(1).max(191).parse(id);
  const { verdict } = sampleInput.parse(input);
  const changed = await db.radarReply.updateMany({ where: { id, aiCategory: { not: '' } }, data: { sampleVerdict: verdict, sampledAt: new Date() } });
  if (!changed.count) throw new HttpError(404, '这封回复没有 AI 判断记录');
  return { id, verdict };
}

const hourIn = (at: Date, timezone: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(at));

/**
 * 每日小结, pushed to administrators once a day from 08:00 (company time) about the day before: new prospects, mails
 * sent, replies by category, bounces, and what is left in the queue.
 */
export async function deliverRadarDailySummary(now = new Date()) {
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const today = dayKey(now, timezone);
  if (hourIn(now, timezone) < 8) return { sent: false };
  const end = localDate(`${today}T00:00:00`, timezone), start = new Date(end.getTime() - DAY);
  const anything = await db.radarProspect.count() + await db.radarSend.count();
  if (!anything) return { sent: false };
  if (!await claimOnce(`radar-daily:${today}`, today, timezone)) return { sent: false };
  const [found, sent, bounced, replies, queue] = await Promise.all([
    db.radarProspect.count({ where: { discoveredAt: { gte: start, lt: end } } }),
    db.radarSend.count({ where: { status: { in: ['SENT', 'BOUNCED'] }, sentAt: { gte: start, lt: end } } }),
    db.radarSend.count({ where: { status: 'BOUNCED', sentAt: { gte: start, lt: end } } }),
    db.radarReply.groupBy({ by: ['category'], where: { receivedAt: { gte: start, lt: end } }, _count: { _all: true } }),
    db.radarSend.count({ where: { status: { in: ['PREPARING', 'REVIEW', 'QUEUED'] } } }),
  ]);
  const byCategory = replies.filter(r => r.category).map(r => `${REPLY_CATEGORIES[r.category as ReplyCategory] ?? r.category} ${r._count._all}`).join('、');
  const total = replies.reduce((sum, r) => sum + r._count._all, 0);
  const body = `新入库 ${found} 家 · 发出 ${sent} 封 · 回复 ${total} 封${byCategory ? `（${byCategory}）` : ''} · 退信 ${bounced} · 队列剩余 ${queue} 封`;
  await notifyAdmins('客户雷达 · 昨日小结', body, '/radar/stats', `radar-daily-${today}`, 20 * 3600);
  return { sent: true, body };
}

/**
 * Removes contact details and texts of companies that ended without reply or said no more than `retentionMonths` ago
 * (GDPR: nothing kept that is no longer needed). Their blocking entries stay, so they are never mailed again.
 */
export async function retentionCleanup(now = new Date(), limit = 50) {
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } });
  const months = readRadarConfig(setting.radarConfig).retentionMonths;
  const before = new Date(now.getTime() - months * 30 * DAY);
  const rows = await db.radarProspect.findMany({ where: { status: { in: ['NO_REPLY', 'NOT_INTERESTED', 'UNSUBSCRIBED', 'EXCLUDED'] }, statusAt: { lt: before }, customerId: null,
    OR: [{ emails: { some: { address: { not: { startsWith: 'erased-' } } } } }, { siteText: { not: null } }, { notes: { not: '' } }] }, select: { id: true }, take: limit });
  for (const r of rows) await db.$transaction(tx => eraseProspectData(r.id, tx, 'MANUAL'));
  return { erased: rows.length };
}

/** The latest of the last three days Gmail has data for, read with the first connected mailbox allowed to. */
async function readSpamRate(domain: string, boxes: { credential: string | null }[], now: Date): Promise<SpamReading> {
  const days = [1, 2, 3].map(back => new Date(now.getTime() - back * DAY).toISOString().slice(0, 10));
  let note = '没有读取权限：请在 Postmaster Tools 验证这个域名，并用验证过的 Google 账号连接发信邮箱';
  for (const box of boxes) {
    try {
      const token = await accessToken(openSecret(box.credential ?? ''));
      for (const day of days) {
        const ratio = await postmasterSpamRatio(token, domain, day);
        if (ratio !== null) return { domain, day, ratio, note: '' };
      }
      return { domain, day: null, ratio: null, note: '发信量太小，Gmail 没有出数据' };
    } catch (error) {
      // Not this account's domain in Postmaster Tools, or no consent for it: try the next mailbox. Never pauses a mailbox.
      if (error instanceof GmailError && error.kind === 'TEMPORARY') note = '暂时连不上 Postmaster Tools，明天再读';
    }
  }
  return { domain, day: null, ratio: null, note };
}

/**
 * Gmail 投诉率 (docs/CUSTOMER_RADAR_COLD_EMAIL.md §8 #15): once a day from 08:00 (company time), each sending domain's
 * spam-report rate from Postmaster Tools. From 0.1% administrators are warned; from 0.3%, Gmail's limit, every mailbox
 * on the domain is paused until someone resumes it. Gmail only reports large senders, so at first there is no data.
 */
export async function checkPostmaster(now = new Date()) {
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const today = dayKey(now, timezone), key = `${POSTMASTER_KEY}${today}`;
  if (!gmailConfigured() || hourIn(now, timezone) < 8 || await db.dailyAdInsight.findUnique({ where: { reportKey: key }, select: { id: true } })) return { checked: false };
  const boxes = await db.radarMailbox.findMany({ where: { credential: { not: null } }, orderBy: { address: 'asc' }, select: { id: true, domain: true, credential: true } });
  if (!boxes.length) return { checked: false };
  const readings: SpamReading[] = [];
  for (const domain of [...new Set(boxes.map(b => b.domain))]) readings.push(await readSpamRate(domain, boxes.filter(b => b.domain === domain), now));
  try {
    await db.dailyAdInsight.create({ data: { reportKey: key, reportDate: new Date(`${today}T00:00:00Z`), timezone, evidence: { readings }, analysis: {}, model: 'postmaster' } });
  } catch (error) {
    // Another run of the job read it first and has alerted.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { checked: false };
    throw error;
  }
  for (const r of readings) {
    if (r.ratio === null || r.ratio < SPAM_WARN) continue;
    const rate = `${r.domain} ${r.day} 的 Gmail 投诉率 ${(r.ratio * 100).toFixed(2)}%`;
    if (r.ratio >= SPAM_PAUSE) {
      for (const box of boxes.filter(b => b.domain === r.domain)) await pauseMailbox(box.id, `${rate}，达到 Gmail 的 0.3% 上限`);
      await notifyAdmins('客户雷达 · 投诉率超限，已暂停发信', `${rate}，达到 0.3%，这个域名的发信邮箱都已暂停。请检查名单和模板后再恢复。`, '/settings/radar', `radar-spam-${r.domain}`, 20 * 3600);
    } else {
      await notifyAdmins('客户雷达 · 投诉率偏高', `${rate}，超过 0.1%。请减量，检查名单和模板。`, '/radar/stats', `radar-spam-${r.domain}`, 20 * 3600);
    }
  }
  return { checked: true, readings };
}
