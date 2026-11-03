import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin, scope } from '@/lib/auth';
import { isEffective, isGoodGrade, median } from '@/lib/analytics';
import { inquiryIn } from '@/lib/metrics';
import { countryCodeOf } from '@/lib/phone-country';
import { dayKey, localDate } from '@/lib/time';
import { clockIn, customerZone, entryLabel, entryOf, inWorkHours, waitText, workHoursOf, workHoursText } from '@/lib/entry-time';
import { REVIEW_AFTER_DAYS, reviewOf, suggestionsFor, type CountryFacts, type ReviewWindow } from '@/lib/ai-plan';
import { countryCard } from './country-card-service';

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const nextKey = (key: string, days: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const at = (key: string, hour: number, tz: string) => hour >= 24 ? localDate(`${nextKey(key, 1)}T00:00`, tz) : localDate(`${key}T${pad(hour)}:00`, tz);

const select = {
  id: true, name: true, country: true, countryCode: true, phone: true, whatsapp: true, waId: true, leadGrade: true, stage: true, isQualified: true,
  productInterest: true, inquiryAt: true, createdAt: true, firstContactAt: true, contactedAt: true, lastOutboundAt: true, lastInboundAt: true,
  lastFollowUpAt: true, nextFollowUpAt: true, quotedAt: true, source: true,
} satisfies Prisma.CustomerSelect;
type Row = Prisma.CustomerGetPayload<{ select: typeof select }>;
type Item = { id: string; key: string; grade: string; title: string; meta: string; wait: string; href: string; done: boolean };
type Block = { key: string; at: Date; time: string; local: string; title: string; why: string; gold: boolean; items: Item[]; note?: string };

/**
 * AI 计划 (docs/METRICS.md §AI 计划): today laid out by when customers are online — first the A / B leads that came
 * in outside the working hours, then due follow-ups (moved into a country's best sending hours when the data shows
 * one), the quiet hours for work that does not need the customer, and the evening wrap-up. A step is ticked off by
 * itself when the work is done (a message sent, a follow-up logged). Then last week against the week before, and ad
 * suggestions to adopt or ignore. Nothing here sends a message or changes an ad.
 */
export async function aiPlan(user: Actor, now = new Date()) {
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, workStartHour: true, workEndHour: true } });
  const tz = settings.timezone, hours = workHoursOf(settings);
  const today = dayKey(now, tz), yesterday = nextKey(today, -1);
  const todayStart = localDate(`${today}T00:00`, tz), tomorrowStart = localDate(`${nextKey(today, 1)}T00:00`, tz);
  const workStart = at(today, hours.start, tz), workEnd = at(today, hours.end, tz), nightFrom = at(yesterday, hours.end, tz);
  const own = scope(user);
  const contactOf = (c: Row) => c.firstContactAt ?? c.contactedAt ?? (c.lastOutboundAt && c.lastOutboundAt >= entryOf(c, tz).at ? c.lastOutboundAt : null);
  const zoneOf = (c: Row) => customerZone(countryCodeOf(c));
  const chat = (id: string) => `/messages?customer=${encodeURIComponent(id)}`;
  const localText = (c: Row, instant: Date) => { const z = zoneOf(c); return z && z !== tz ? `（${c.country || '当地'} ${entryLabel(instant, z)}）` : ''; };

  // Night leads: A / B that came in between yesterday's end of work and this morning's start.
  const [night, due, waiting, demandToConfirm, readyNoQuote, pendingSuggestions] = await Promise.all([
    db.customer.findMany({ where: { AND: [own, { inquiryAt: { gte: nightFrom, lt: workStart } }, { leadGrade: { in: ['A', 'B'] } }, { stage: { not: 'INVALID' } }] }, select }),
    db.customer.findMany({ where: { AND: [own, { stage: { notIn: ['WON', 'LOST', 'INVALID', 'PAUSED'] } }, { OR: [
      { nextFollowUpAt: { lt: tomorrowStart } },
      { quotedAt: { lte: new Date(now.getTime() - 3 * DAY) }, stage: { in: ['QUOTED', 'FOLLOW_UP'] } },
    ] }] }, select, take: 200 }),
    db.customer.findMany({ where: { AND: [own, { leadGrade: { in: ['A', 'B'] } }, { stage: { notIn: ['LOST', 'INVALID', 'PAUSED'] } }, { lastInboundAt: { not: null } }] }, select, orderBy: { lastInboundAt: 'desc' }, take: 300 }),
    db.customerDemandField.groupBy({ by: ['customerId'], where: { status: 'SUGGESTED', customer: own }, _count: { _all: true } }),
    db.customer.findMany({ where: { AND: [own, { stage: { notIn: ['WON', 'LOST', 'INVALID', 'PAUSED'] } }, { quotations: { none: {} } },
      { demandFields: { some: { field: 'size', status: 'CONFIRMED' } } }, { demandFields: { some: { field: 'quantity', status: 'CONFIRMED' } } }, { demandFields: { some: { field: 'port', status: 'CONFIRMED' } } }] },
      select: { id: true, name: true, country: true }, take: 5 }),
    db.planSuggestion.count({ where: { status: 'PENDING' } }),
  ]);

  const waitedOf = (c: Row) => ((contactOf(c) ?? now).getTime() - entryOf(c, tz).at.getTime()) / MINUTE;
  const nightItems: Item[] = [...night].sort((a, b) => Number(!!contactOf(a)) - Number(!!contactOf(b)) || a.leadGrade.localeCompare(b.leadGrade) || waitedOf(b) - waitedOf(a)).map(c => {
    const entry = entryOf(c, tz), contact = contactOf(c);
    const waited = waitedOf(c);
    return { id: c.id, key: `n-${c.id}`, grade: c.leadGrade, done: !!contact, href: chat(c.id),
      title: `${c.name} · ${c.country || '国家未知'}${c.productInterest ? ` · ${c.productInterest.slice(0, 30)}` : ''}`,
      meta: `进线 ${entryLabel(entry.at, tz)}${localText(c, entry.at)}`, wait: contact ? `已联系 · 等了 ${waitText(waited)}` : `等了 ${waitText(waited)}` };
  });

  // Waiting for us: effective customers whose last message is theirs.
  const waitingRows = waiting.filter(c => isEffective(c) && c.lastInboundAt && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt));
  const waitingItems: Item[] = waitingRows.slice(0, 8).map(c => ({ id: c.id, key: `w-${c.id}`, grade: c.leadGrade, done: false, href: chat(c.id),
    title: `${c.name} · ${c.country || '国家未知'}`, meta: `客户 ${entryLabel(c.lastInboundAt!, tz)} 发来消息${localText(c, now) ? ` · 对方现在${localText(c, now)}` : ''}`,
    wait: `等了 ${waitText((now.getTime() - c.lastInboundAt!.getTime()) / MINUTE)}` }));

  // Due follow-ups; each goes to its country's best sending hours when the country card has found them.
  const dueRows = due.filter(c => !night.some(n => n.id === c.id));
  const countries = [...new Set([...dueRows, ...night].map(c => c.country.trim()).filter(Boolean))];
  const topCountries = await topCountriesOf(user, now);
  const cards = await Promise.all([...new Set([...topCountries, ...countries.slice(0, 3)])].slice(0, 4).map(country => countryCard(user, { country, weeks: '12' }, now)));
  const windowOf = new Map<string, { start: number; end: number; rate: number; localStart: string; localEnd: string }>();
  for (const card of cards) if (!card.empty && card.sendMap.best) windowOf.set(card.country, card.sendMap.best);
  const followItem = (c: Row): Item => {
    const staleQuote = c.quotedAt && c.quotedAt <= new Date(now.getTime() - 3 * DAY) && (!c.lastInboundAt || c.lastInboundAt < c.quotedAt);
    const done = !!((c.lastOutboundAt && c.lastOutboundAt >= todayStart) || (c.lastFollowUpAt && c.lastFollowUpAt >= todayStart));
    return { id: c.id, key: `f-${c.id}`, grade: c.leadGrade, done, href: chat(c.id), title: `${c.name} · ${c.country || '国家未知'}`,
      meta: staleQuote ? `报价发出 ${Math.floor((now.getTime() - c.quotedAt!.getTime()) / DAY)} 天没回音` : c.nextFollowUpAt && c.nextFollowUpAt < todayStart ? `约好的跟进已过期（${dayKey(c.nextFollowUpAt, tz)}）` : '约好今天跟进',
      wait: '' };
  };
  const blocks: Block[] = [];
  blocks.push({ key: 'night', at: workStart, time: `${hours.start}:00`, local: '', gold: false, title: '先处理工作时间外进线的 A / B',
    why: `你下班后（${hours.end}:00 以后）到今早进来的，按等级和等了多久排；越早联系有效率越高。`, items: nightItems,
    note: nightItems.length ? undefined : '昨晚没有新的 A / B 线索。' });
  const general = dueRows.filter(c => !windowOf.has(c.country.trim()));
  blocks.push({ key: 'due', at: new Date(workStart.getTime() + 1.5 * HOUR), time: `${hours.start + 1}:30`, local: '', gold: false, title: '到期的跟进',
    why: '约好今天跟进的、报价发出 3 天没回音的；发出去就自动打勾。', items: general.slice(0, 10).map(followItem),
    note: general.length ? (general.length > 10 ? `还有 ${general.length - 10} 位，在「待处理」里看全部。` : undefined) : '没有到期的跟进。' });
  for (const [country, w] of windowOf) {
    const rows = dueRows.filter(c => c.country.trim() === country);
    blocks.push({ key: `gold-${country}`, at: at(today, w.start, tz), time: `${w.start}:00`, local: `${country} ${w.localStart}`, gold: true,
      title: `发给${country}客户（回复率最高的时段）`, why: `${country}客户在北京 ${w.start}:00–${w.end}:00 收到首条，回复率 ${w.rate}%；${country}的跟进和首条都排在这里。`,
      items: rows.slice(0, 10).map(followItem), note: rows.length ? undefined : `今天没有到期的${country}跟进；新线索的首条也尽量在这个时段发。` });
  }
  const quiet: Item[] = [
    ...(demandToConfirm.length ? [{ id: '', key: 'q-demand', grade: '', done: false, href: '/messages', title: `确认 ${demandToConfirm.length} 位客户的需求画像`, meta: 'AI 已从聊天里摘出尺寸、数量、目的港，你看一眼改错的', wait: '' }] : []),
    ...readyNoQuote.map(c => ({ id: c.id, key: `q-quote-${c.id}`, grade: '', done: false, href: `/products/quotes/new?customerId=${encodeURIComponent(c.id)}`, title: `给 ${c.name} 出报价单`, meta: '尺寸、数量、目的港都确认了；价格从产品库带出', wait: '' })),
    ...(pendingSuggestions ? [{ id: '', key: 'q-ads', grade: '', done: false, href: '#ads', title: `看 ${pendingSuggestions} 条广告建议`, meta: '在下面，采纳后去 Meta 后台改', wait: '' }] : []),
  ];
  blocks.push({ key: 'quiet', at: new Date(workStart.getTime() + 3 * HOUR), time: `${hours.start + 3}:00`, local: '', gold: false, title: '不着急的事',
    why: '不需要客户在线的：确认需求、准备报价、看数据。', items: quiet, note: quiet.length ? undefined : '没有待确认的需求和待出的报价。' });
  blocks.push({ key: 'wrap', at: new Date(workEnd.getTime() - 0.5 * HOUR), time: `${hours.end - 1}:30`, local: '', gold: false, title: '收尾',
    why: `${hours.end}:00 以后进线的 A / B 会自动排进明天 ${hours.start}:00 这一块。`, items: [] });
  blocks.sort((a, b) => a.at.getTime() - b.at.getTime());
  const current = [...blocks].reverse().find(b => b.at <= now)?.key ?? null;

  const [week, suggestions] = await Promise.all([weeklyReport(user, tz, hours, now), suggestionsList(user, cards.filter(c => !c.empty), hours, tz, now)]);
  const all = blocks.flatMap(b => b.items);
  return {
    today, timezone: tz, hours, workText: workHoursText(hours), now,
    clocks: cards.filter(c => !c.empty && c.zone).map(c => ({ country: c.country, time: entryLabel(now, c.zone!) })),
    summary: { night: nightItems.length, nightOpen: nightItems.filter(i => !i.done).length, due: dueRows.length, waiting: waitingRows.length, suggestions: suggestions.filter(s => s.status === 'PENDING').length },
    waiting: waitingItems,
    blocks: blocks.map(b => ({ ...b, now: b.key === current })),
    progress: { done: all.filter(i => i.done).length, total: all.filter(i => i.id).length },
    week, suggestions, admin: user.role === 'ADMIN',
  };
}
export type AiPlan = Awaited<ReturnType<typeof aiPlan>>;

async function topCountriesOf(user: Actor, now: Date) {
  const rows = await db.customer.groupBy({ by: ['country'], where: { AND: [scope(user), inquiryIn({ start: new Date(now.getTime() - 56 * DAY), end: now }), { leadGrade: { in: ['A', 'B'] } }, { country: { not: '' } }] },
    _count: { _all: true }, orderBy: { _count: { country: 'desc' } }, take: 3 });
  return rows.map(r => r.country.trim());
}

/** Last full week (Monday to Sunday, company time) against the week before: effective customers, cost each, first-contact speed. */
async function weeklyReport(user: Actor, tz: string, hours: { start: number; end: number }, now: Date) {
  const today = dayKey(now, tz);
  const weekday = clockIn(now, tz).weekday;
  const thisMonday = nextKey(today, -weekday);
  const windows = [{ start: localDate(`${nextKey(thisMonday, -7)}T00:00`, tz), end: localDate(`${thisMonday}T00:00`, tz) },
    { start: localDate(`${nextKey(thisMonday, -14)}T00:00`, tz), end: localDate(`${nextKey(thisMonday, -7)}T00:00`, tz) }];
  const facts = await Promise.all(windows.map(async w => {
    const rows = await db.customer.findMany({ where: { AND: [scope(user), inquiryIn(w)] }, select });
    const ab = rows.filter(c => isGoodGrade(c.leadGrade)), effective = ab.filter(isEffective);
    const metrics = await db.marketingMetric.findMany({ where: { metricDate: { gte: w.start, lt: w.end } }, select: { spend: true, campaign: { select: { currency: true } } } });
    const spend = metrics.length ? Math.round(metrics.reduce((s, m) => s + Number(m.spend), 0) * 100) / 100 : null;
    const currency = metrics[0]?.campaign.currency ?? null;
    const waits = ab.flatMap(c => { const e = entryOf(c, tz), contact = c.firstContactAt ?? c.contactedAt; return e.exact && contact ? [Math.max(0, (contact.getTime() - e.at.getTime()) / MINUTE)] : []; });
    const exact = ab.filter(c => entryOf(c, tz).exact);
    const byCountry = new Map<string, number>();
    for (const c of effective) byCountry.set(c.country.trim() || '未填国家', (byCountry.get(c.country.trim() || '未填国家') ?? 0) + 1);
    return { ab: ab.length, effective: effective.length, spend, currency, perEffective: spend !== null && effective.length ? Math.round(spend / effective.length * 100) / 100 : null,
      contact: median(waits.map(Math.round)), offShare: exact.length ? Math.round(exact.filter(c => !inWorkHours(entryOf(c, tz).at, tz, hours)).length / exact.length * 100) : null, byCountry };
  }));
  const [last, before] = facts;
  const countryDelta = [...new Set([...last.byCountry.keys(), ...before.byCountry.keys()])]
    .map(country => ({ country, delta: (last.byCountry.get(country) ?? 0) - (before.byCountry.get(country) ?? 0) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  return {
    label: `${dayKey(windows[0].start, tz)} — ${nextKey(thisMonday, -1)}`,
    last: { ab: last.ab, effective: last.effective, perEffective: last.perEffective, contact: last.contact, spend: last.spend, currency: last.currency, offShare: last.offShare },
    before: { ab: before.ab, effective: before.effective, perEffective: before.perEffective, contact: before.contact, spend: before.spend },
    mover: countryDelta && countryDelta.delta !== 0 ? countryDelta : null,
  };
}

/** Writes this week's suggestions (once per kind, country and week), reviews adopted ones that are due, and lists them. */
async function suggestionsList(user: Actor, cards: Extract<Awaited<ReturnType<typeof countryCard>>, { empty: false }>[], hours: { start: number; end: number }, tz: string, now: Date) {
  const monday = nextKey(dayKey(now, tz), -clockIn(now, tz).weekday);
  for (const card of cards) {
    const localWork = card.zone ? { start: `${clockIn(at(monday, hours.start, tz), card.zone).hour}:00`, end: `${clockIn(at(monday, hours.end, tz), card.zone).hour}:00` } : null;
    const facts: CountryFacts = { country: card.country, localOffset: card.offset, days: card.days, offEntry: card.offEntry, offShare: card.kpis.offShare,
      inN: card.speed.reduce((s, b) => s + b.n, 0) - card.offEntry.n, hours, localWork,
      ads: card.ads.list.map(a => ({ name: a.name, effective: a.effective, perEffective: a.perEffective })) };
    for (const s of suggestionsFor(facts)) {
      const key = `${s.kind}:${s.country}:${monday}`.slice(0, 191);
      await db.planSuggestion.upsert({ where: { key }, update: {}, create: { key, kind: s.kind, country: s.country, title: s.title.slice(0, 200), body: s.body, basis: s.basis.slice(0, 300),
        metric: { weight: s.weight, effectiveRate: card.kpis.effectiveRate, perEffective: card.kpis.perEffective } } });
    }
  }
  // Review adopted suggestions seven days on: the country's numbers in the week after against the week before.
  const due = await db.planSuggestion.findMany({ where: { status: 'ADOPTED', reviewAt: { lte: now } }, orderBy: { reviewAt: 'asc' }, take: 20 });
  for (const s of due.filter(d => d.review === null)) {
    const decided = s.decidedAt ?? s.createdAt;
    const [before, after] = await Promise.all([reviewWindow(user, s.country, { start: new Date(decided.getTime() - REVIEW_AFTER_DAYS * DAY), end: decided }),
      reviewWindow(user, s.country, { start: decided, end: new Date(decided.getTime() + REVIEW_AFTER_DAYS * DAY) })]);
    await db.planSuggestion.update({ where: { id: s.id }, data: { review: reviewOf(before, after) } });
  }
  const rows = await db.planSuggestion.findMany({ where: { OR: [{ status: 'PENDING', createdAt: { gte: new Date(now.getTime() - 21 * DAY) } }, { decidedAt: { gte: new Date(now.getTime() - 30 * DAY) } }] },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 12 });
  return rows.map(r => ({ id: r.id, kind: r.kind, country: r.country, title: r.title, body: r.body, basis: r.basis, status: r.status, decidedAt: r.decidedAt, reviewAt: r.reviewAt,
    review: r.review as ReturnType<typeof reviewOf> | null }));
}

async function reviewWindow(user: Actor, country: string, w: { start: Date; end: Date }): Promise<ReviewWindow> {
  const rows = await db.customer.findMany({ where: { AND: [scope(user), inquiryIn(w), { country }] }, select });
  const ab = rows.filter(c => isGoodGrade(c.leadGrade));
  const code = countryCodeOf({ country });
  const spendRows = code ? await db.adDailyMetric.findMany({ where: { grain: 'COUNTRY', country: code, metricDate: { gte: w.start, lt: w.end } }, select: { spend: true } }) : [];
  return { ab: ab.length, effective: ab.filter(isEffective).length, spend: spendRows.length ? spendRows.reduce((s, r) => s + Number(r.spend), 0) : null };
}

const decideInput = z.object({ id: z.string().min(1).max(191), status: z.enum(['ADOPTED', 'IGNORED', 'PENDING']) });
/** 采纳 / 忽略 / 撤回 a suggestion. Adopting only records the decision and schedules the review; the change itself is made in Meta. */
export async function decideSuggestion(user: Actor, input: unknown, now = new Date()) {
  requireAdmin(user, '只有管理员可以处理广告建议');
  const v = decideInput.parse(input);
  const found = await db.planSuggestion.findUnique({ where: { id: v.id } });
  if (!found) throw new HttpError(404, '建议不存在');
  const pending = v.status === 'PENDING';
  await db.planSuggestion.update({ where: { id: v.id }, data: { status: v.status, decidedById: pending ? null : user.id, decidedAt: pending ? null : now,
    reviewAt: v.status === 'ADOPTED' ? new Date(now.getTime() + REVIEW_AFTER_DAYS * DAY) : null, review: Prisma.DbNull } });
  return { id: v.id, status: v.status };
}
