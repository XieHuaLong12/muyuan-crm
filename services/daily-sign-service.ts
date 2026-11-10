import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { dayKey, localDate } from '@/lib/time';
import { countryCodeOf } from '@/lib/phone-country';
import { workHoursOf } from '@/lib/entry-time';
import { SIGN_TOPICS, drawSign, hash, isSignTopic, streak, weekLine, type Facts, type Gift, type SignContent, type SignTopic } from '@/lib/daily-sign';
import { countryCard } from './country-card-service';

const DAY = 86_400_000;
const FALLBACK_GIFTS: Gift[] = [
  { text: '不积跬步，无以至千里。', source: '荀子《劝学》' },
  { text: '天下难事，必作于易；天下大事，必作于细。', source: '《道德经》' },
  { text: '行百里者半九十。', source: '《战国策》' },
];
const nextKey = (key: string, days: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

async function settings() {
  const s = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, workStartHour: true, workEndHour: true } });
  return { timezone: s.timezone, hours: workHoursOf(s) };
}

/**
 * Today's sign card on the work calendar: the sign if drawn (as it was drawn — it does not change during the day),
 * whether the evening check is open (from half an hour before the end of the working day), the day's real numbers
 * for it, days in a row, signs that came true this month, and this week's sign book.
 */
export async function dailySign(user: Actor, now = new Date()) {
  const { timezone, hours } = await settings();
  const today = dayKey(now, timezone);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = nextKey(today, -weekday);
  const [mine, row, due] = await Promise.all([
    db.dailySign.findMany({ where: { userId: user.id, day: { gte: nextKey(today, -120) } }, select: { day: true, topic: true, grade: true, verdict: true }, orderBy: { day: 'asc' } }),
    db.dailySign.findUnique({ where: { userId_day: { userId: user.id, day: today } } }),
    db.wallNote.count({ where: { userId: user.id, archivedAt: null, remindOn: { lte: localDate(`${nextKey(today, 1)}T00:00`, timezone) }, status: { not: 'DONE' } } }),
  ]);
  const checkFrom = localDate(`${today}T${String(hours.end).padStart(2, '0')}:00`, timezone).getTime() - 30 * 60_000;
  const canCheck = !!row && now.getTime() >= checkFrom;
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = nextKey(monday, i), s = mine.find(x => x.day === day);
    return { day, label: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i], grade: s?.grade ?? '', verdict: s?.verdict ?? '', today: day === today, future: day > today };
  });
  return {
    today, timezone, hours,
    topics: Object.entries(SIGN_TOPICS).map(([key, [icon, label]]) => ({ key, icon, label })),
    sign: row ? { topic: row.topic, content: row.content as unknown as SignContent, collected: !!row.collectedAt, verdict: row.verdict } : null,
    canCheck, checkAt: `${hours.end - 1}:30`,
    check: canCheck && row ? await dayCheck(user, row.topic as SignTopic, today, timezone) : null,
    streak: streak(mine.map(s => s.day), today),
    cameTrue: mine.filter(s => s.day.slice(0, 7) === today.slice(0, 7) && s.verdict === 'YES').length,
    week, weekLine: weekLine(mine.filter(s => s.day >= monday)), remindersDue: due,
  };
}
export type DailySignView = Awaited<ReturnType<typeof dailySign>>;

const drawInput = z.object({ topic: z.string().refine(isSignTopic, '先选今天想问什么') });
/** 求签: once a day. Asking again the same day returns the sign already drawn. */
export async function drawToday(user: Actor, input: unknown, now = new Date()) {
  const v = drawInput.parse(input);
  const topic = v.topic as SignTopic;
  const { timezone, hours } = await settings();
  const today = dayKey(now, timezone);
  const existing = await db.dailySign.findUnique({ where: { userId_day: { userId: user.id, day: today } } });
  if (existing) return dailySign(user, now);
  const [facts, gift] = await Promise.all([factsFor(user, today, timezone, hours, now), giftFor(user, today)]);
  const content = drawSign(user.id, today, topic, facts, gift);
  try {
    await db.dailySign.create({ data: { userId: user.id, day: today, topic, signNo: content.no, grade: content.grade, content: content as unknown as Prisma.InputJsonValue } });
  } catch (e) {
    // Two clicks at once: the first one wins and both see the same sign.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }
  return dailySign(user, now);
}

const updateInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('collect') }),
  z.object({ action: z.literal('reopen') }),
  z.object({ action: z.literal('verdict'), verdict: z.enum(['YES', 'NO']) }),
]);
/** 收下 (fold into a strip), 再看一眼, and the evening 灵 / 不太灵. */
export async function updateSign(user: Actor, input: unknown, now = new Date()) {
  const v = updateInput.parse(input);
  const { timezone, hours } = await settings();
  const today = dayKey(now, timezone);
  const row = await db.dailySign.findUnique({ where: { userId_day: { userId: user.id, day: today } } });
  if (!row) throw new HttpError(404, '今天还没求签');
  if (v.action === 'verdict') {
    const checkFrom = localDate(`${today}T${String(hours.end).padStart(2, '0')}:00`, timezone).getTime() - 30 * 60_000;
    if (now.getTime() < checkFrom) throw new HttpError(400, `${hours.end - 1}:30 以后再来对签`);
    await db.dailySign.update({ where: { id: row.id }, data: { verdict: v.verdict, verdictAt: now } });
  } else {
    await db.dailySign.update({ where: { id: row.id }, data: { collectedAt: v.action === 'collect' ? now : null } });
  }
  return dailySign(user, now);
}

/** 今日赠言: one of the person's own quotes from the wall, else a classic line. */
async function giftFor(user: Actor, today: string): Promise<Gift> {
  const quotes = await db.wallNote.findMany({ where: { userId: user.id, kind: 'QUOTE', archivedAt: null }, select: { text: true, source: true }, orderBy: { createdAt: 'asc' } });
  const list = quotes.length ? quotes.map(q => ({ text: q.text, source: q.source || '自己写的' })) : FALLBACK_GIFTS;
  return list[hash(`${user.id}|${today}|gift`) % list.length];
}

/** What today's sign can say about work: the main market and its best hours, a quote waiting, last night's leads… */
async function factsFor(user: Actor, today: string, timezone: string, hours: { start: number; end: number }, now: Date): Promise<Facts> {
  const own = scope(user);
  const since = new Date(now.getTime() - 56 * DAY);
  const yesterdayEnd = localDate(`${nextKey(today, -1)}T${String(Math.min(hours.end, 23)).padStart(2, '0')}:00`, timezone);
  const workStart = localDate(`${today}T${String(hours.start).padStart(2, '0')}:00`, timezone);
  const [markets, staleQuote, nightLeads, pendingSuggestions, oldIdea] = await Promise.all([
    db.customer.groupBy({ by: ['country'], where: { AND: [own, { inquiryAt: { gte: since } }, { leadGrade: { in: ['A', 'B'] } }, { isQualified: true }, { country: { not: '' } }] },
      _count: { _all: true }, orderBy: { _count: { country: 'desc' } }, take: 1 }),
    db.customer.findFirst({ where: { AND: [own, { stage: { in: ['QUOTED', 'FOLLOW_UP'] } }, { quotedAt: { lte: new Date(now.getTime() - 3 * DAY) } },
      { OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: db.customer.fields.quotedAt } }] }] }, orderBy: { quotedAt: 'desc' }, select: { name: true, quotedAt: true } }),
    db.customer.count({ where: { AND: [own, { inquiryAt: { gte: yesterdayEnd, lt: workStart } }, { leadGrade: { in: ['A', 'B'] } }] } }),
    user.role === 'ADMIN' ? db.planSuggestion.count({ where: { status: 'PENDING' } }) : Promise.resolve(0),
    db.wallNote.findFirst({ where: { userId: user.id, kind: 'IDEA', archivedAt: null, status: { in: ['NEW', 'WANT'] }, updatedAt: { lte: new Date(now.getTime() - 14 * DAY) } }, orderBy: { updatedAt: 'asc' }, select: { text: true, updatedAt: true } }),
  ]);
  const country = markets[0]?.country.trim() ?? '';
  let luckyHours: string | null = null, costlyAd: string | null = null;
  if (country) {
    try {
      const card = await countryCard(user, { country, weeks: '12' }, now);
      if (!card.empty) {
        if (card.sendMap.best) luckyHours = `${card.sendMap.best.start}:00–${card.sendMap.best.end}:00`;
        const overall = card.ads.overallPerEffective;
        const dear = overall === null ? null : card.ads.list.filter(a => a.perEffective !== null && a.perEffective > overall * 1.3).sort((a, b) => (b.perEffective ?? 0) - (a.perEffective ?? 0))[0];
        costlyAd = dear?.name ?? null;
      }
    } catch { /* The sign still works without the country card. */ }
  }
  return {
    country, countryCode: country ? countryCodeOf({ country }) : '', luckyHours,
    staleQuote: staleQuote?.quotedAt ? { name: staleQuote.name, days: Math.floor((now.getTime() - staleQuote.quotedAt.getTime()) / DAY) } : null,
    nightLeads, pendingSuggestions, costlyAd,
    oldIdea: oldIdea ? { text: oldIdea.text, days: Math.floor((now.getTime() - oldIdea.updatedAt.getTime()) / DAY) } : null,
  };
}

/** 对签: today's real numbers for the question asked in the morning. */
async function dayCheck(user: Actor, topic: SignTopic, today: string, timezone: string) {
  const start = localDate(`${today}T00:00`, timezone), end = localDate(`${nextKey(today, 1)}T00:00`, timezone);
  const own = scope(user);
  const within = { gte: start, lt: end };
  switch (topic) {
    case 'DEAL': {
      const [deals, followed] = await Promise.all([
        db.deal.count({ where: { dealDate: within, customer: own } }),
        db.customer.findMany({ where: { AND: [own, { quotedAt: { not: null, lt: start } }, { lastOutboundAt: within }] }, select: { lastInboundAt: true } }),
      ]);
      const replied = followed.filter(c => c.lastInboundAt && c.lastInboundAt >= start).length;
      return `${deals ? `收到 ${deals} 笔订单` : '今天没有新订单'} · 跟进了 ${followed.length} 位报过价的客户${followed.length ? `，${replied} 位回了` : ''}`;
    }
    case 'CLIENT': {
      const leads = await db.customer.findMany({ where: { AND: [own, { inquiryAt: within }, { leadGrade: { in: ['A', 'B'] } }] }, select: { firstContactAt: true, contactedAt: true, lastInboundAt: true } });
      const contacted = leads.filter(c => c.firstContactAt || c.contactedAt).length;
      return `新进线 A / B ${leads.length} 位，联系了 ${contacted} 位，${leads.filter(c => c.lastInboundAt && c.lastInboundAt >= start).length} 位回了`;
    }
    case 'ADS': {
      const [leads, effective] = await Promise.all([
        db.customer.count({ where: { AND: [own, { inquiryAt: within }, { leadGrade: { in: ['A', 'B'] } }] } }),
        db.customer.count({ where: { AND: [own, { inquiryAt: within }, { leadGrade: { in: ['A', 'B'] } }, { isQualified: true }] } }),
      ]);
      return `广告今天带来 A / B ${leads} 位，已经有 ${effective} 位回了话`;
    }
    case 'IDEA': {
      const [added, moved] = await Promise.all([
        db.wallNote.count({ where: { userId: user.id, createdAt: within } }),
        db.wallNote.count({ where: { userId: user.id, kind: 'IDEA', createdAt: { lt: start }, updatedAt: within } }),
      ]);
      return `今天往想法墙贴了 ${added} 张，挪动了 ${moved} 张旧纸条`;
    }
    default: {
      const sent = await db.whatsAppMessage.findMany({ where: { sentById: user.id, direction: 'OUTBOUND', sentAt: within }, select: { customerId: true } });
      return `今天在 BOS 里发了 ${sent.length} 条消息，回了 ${new Set(sent.map(m => m.customerId)).size} 位客户`;
    }
  }
}
