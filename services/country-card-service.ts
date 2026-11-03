import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { funnelDepth, isEffective, isGoodGrade, median } from '@/lib/analytics';
import { inquiryIn } from '@/lib/metrics';
import { countryCodeOf } from '@/lib/phone-country';
import { dayKey, localDate } from '@/lib/time';
import { CONTACT_SPEED_BUCKETS, clockIn, contactSpeedBucket, customerZone, entryOf, inWorkHours, offsetLabel, workHoursOf, workHoursText } from '@/lib/entry-time';
import { MIN_GROUP, REPLY_WINDOW_MS, bestWindow, findings, gridView, heat, marginals, pct, touchRates, touches, type Msg } from '@/lib/country-card';
import { DEMAND_FIELDS, lossReasonOf, LOSS_REASONS } from '@/lib/demand-profile';
import { upcomingHolidays } from '@/lib/holidays';

const DAY = 86_400_000, MINUTE = 60_000;
const querySchema = z.object({
  country: z.string().trim().max(100).catch(''),
  weeks: z.coerce.number().int().refine(v => [4, 8, 12, 26].includes(v)).catch(8),
  clock: z.enum(['company', 'local']).catch('company'),
});
export type CountryCardQuery = z.infer<typeof querySchema>;

const select = {
  id: true, name: true, country: true, countryCode: true, phone: true, whatsapp: true, waId: true, leadGrade: true, stage: true, isQualified: true,
  inquiryAt: true, createdAt: true, firstContactAt: true, contactedAt: true, lastOutboundAt: true, lastFollowUpAt: true, needsConfirmedAt: true, quotedAt: true,
  invalidReason: true, quotations: { where: { status: 'SENT' }, select: { id: true }, take: 1 }, deals: { select: { id: true }, take: 1 },
} satisfies Prisma.CustomerSelect;
type Row = Prisma.CustomerGetPayload<{ select: typeof select }>;

/**
 * 国家作战卡 (docs/METRICS.md §国家作战卡): one country's leads over the last weeks, by 进线时间 — which entry
 * times bring A / B, which send times get answers, how fast first contact pays off, when to stop following up, which
 * ads are worth their money, what customers ask for, how long a deal takes and why customers are lost. Read only;
 * administrators see every customer, sales their own.
 */
export async function countryCard(user: Actor, query: Record<string, string | undefined> = {}, now = new Date()) {
  const q = querySchema.parse(query);
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, workStartHour: true, workEndHour: true, usdCnyRate: true, eurCnyRate: true } });
  const timezone = settings.timezone, hours = workHoursOf(settings);
  const period = { start: new Date(now.getTime() - q.weeks * 7 * DAY), end: now };
  const year = { start: new Date(now.getTime() - 365 * DAY), end: now };
  const customerScope = scope(user);

  // Countries to pick from: by A / B leads in the period.
  const inPeriod = await db.customer.findMany({ where: { AND: [customerScope, inquiryIn(period), { country: { not: '' } }] }, select: { country: true, leadGrade: true } });
  const tally = new Map<string, { leads: number; ab: number }>();
  for (const c of inPeriod) { const key = c.country.trim(); const t = tally.get(key) ?? { leads: 0, ab: 0 }; t.leads++; if (isGoodGrade(c.leadGrade)) t.ab++; tally.set(key, t); }
  const countries = [...tally].map(([name, t]) => ({ name, ...t })).sort((a, b) => b.ab - a.ab || b.leads - a.leads || a.name.localeCompare(b.name, 'zh-CN'));
  const country = q.country || countries[0]?.name || '';
  const code = country ? countryCodeOf({ country }) : '';
  const zone = customerZone(code);
  const base = { query: { ...q, country }, timezone, hours, workText: workHoursText(hours), countries: countries.slice(0, 12), country, code, zone,
    offset: zone ? offsetLabel(now, zone) : null, periodLabel: `近 ${q.weeks} 周 · ${dayKey(period.start, timezone)} — ${dayKey(now, timezone)}` };
  if (!country) return { ...base, empty: true as const };

  const sameCountry: Prisma.CustomerWhereInput = { country };
  const [rows, yearRows] = await Promise.all([
    db.customer.findMany({ where: { AND: [customerScope, inquiryIn(period), sameCountry] }, select }),
    db.customer.findMany({ where: { AND: [customerScope, inquiryIn(year), sameCountry] }, select: { ...select, deals: { select: { dealDate: true, dealAmount: true, grossProfit: true, currency: true }, orderBy: { dealDate: 'asc' } } } }),
  ]);
  const ids = rows.map(c => c.id);
  const viewZone = q.clock === 'local' && zone ? zone : timezone;
  const ab = rows.filter(c => isGoodGrade(c.leadGrade)), effective = ab.filter(isEffective);
  const won = effective.filter(c => funnelDepth(c) >= 5).length;

  // Messages of these customers: first send per customer, touches, read receipts.
  const messages = ids.length ? await db.whatsAppMessage.findMany({ where: { customerId: { in: ids }, status: { notIn: ['FAILED', 'PENDING'] } },
    select: { customerId: true, direction: true, sentAt: true, readAt: true }, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }] }) : [];
  const byCustomer = new Map<string, Msg[]>();
  for (const m of messages) byCustomer.set(m.customerId, [...byCustomer.get(m.customerId) ?? [], m]);
  const firstOut = new Map<string, Msg>();
  for (const [id, list] of byCustomer) { const out = list.find(m => m.direction === 'OUTBOUND'); if (out) firstOut.set(id, out); }
  const repliedAfter = (id: string, m: Msg) => (byCustomer.get(id) ?? []).some(x => x.direction === 'INBOUND' && x.sentAt > m.sentAt && x.sentAt.getTime() - m.sentAt.getTime() <= REPLY_WINDOW_MS);
  const closed = (m: Msg) => now.getTime() - m.sentAt.getTime() >= REPLY_WINDOW_MS;

  // 1. 进线时间 × A / B 占比 (exact entry times only).
  const exact = rows.map(c => ({ c, entry: entryOf(c, timezone) })).filter(x => x.entry.exact);
  const companyOff = (at: Date) => !inWorkHours(at, timezone, hours);
  // A cell is outside the working hours when its hour, read in company time, is (the local view shifts the hours).
  const offOf = (weekday: number, hour: number) => {
    if (viewZone === timezone) return hour < hours.start || hour >= hours.end;
    const probe = sampleInstant(weekday, hour, viewZone, now);
    return probe ? companyOff(probe) : false;
  };
  const entryGrid = heat(exact, x => x.entry.at, x => isGoodGrade(x.c.leadGrade), viewZone);
  // 2. 我们发首条的时间 × 3 天内回复率 (sends whose window has closed).
  const sends = [...firstOut].filter(([, m]) => closed(m)).map(([id, m]) => ({ id, m }));
  const sendGrid = heat(sends, s => s.m.sentAt, s => repliedAfter(s.id, s.m), viewZone);
  const sendCompanyGrid = viewZone === timezone ? sendGrid : heat(sends, s => s.m.sentAt, s => repliedAfter(s.id, s.m), timezone);
  const sendHours = marginals(sendCompanyGrid).hours;
  const best = bestWindow(sendHours, hours);
  const overallReply = pct(sends.filter(s => repliedAfter(s.id, s.m)).length, sends.length);
  const localHour = (hour: number) => {
    if (!zone) return `${hour}:00`;
    const probe = sampleInstant(0, hour, timezone, now);
    return probe ? `${clockIn(probe, zone).hour}:00` : `${hour}:00`;
  };

  // 3. 首联速度: A / B with an exact entry and a first contact, by minutes waited.
  const abExact = exact.filter(x => isGoodGrade(x.c.leadGrade));
  const contactOf = (c: Row) => firstOut.get(c.id)?.sentAt ?? c.firstContactAt ?? c.contactedAt;
  const speedRows = abExact.flatMap(x => { const at = contactOf(x.c); return at ? [{ ...x, minutes: Math.max(0, (at.getTime() - x.entry.at.getTime()) / MINUTE) }] : []; });
  const speed = CONTACT_SPEED_BUCKETS.map((bucket, i) => {
    const list = speedRows.filter(r => contactSpeedBucket(r.minutes) === i);
    return { key: bucket.key, label: bucket.label, n: list.length, effective: list.filter(r => isEffective(r.c)).length, rate: pct(list.filter(r => isEffective(r.c)).length, list.length) };
  });
  const offAb = abExact.filter(x => companyOff(x.entry.at)), inAb = abExact.filter(x => !companyOff(x.entry.at));
  const offWaits = offAb.flatMap(x => { const at = contactOf(x.c); return at ? [(at.getTime() - x.entry.at.getTime()) / MINUTE] : []; });
  const fast = speedRows.filter(r => r.minutes <= 30), slow = speedRows.filter(r => r.minutes > 120);

  // 4. 跟进到第几次: touches until the customer writes, and read receipts of the first message.
  const allTouches = [...byCustomer.values()].flatMap(list => touches(list, now));
  const follow = touchRates(allTouches);
  const firsts = [...firstOut].map(([id, m]) => ({ id, m }));
  const readMinutes = firsts.flatMap(f => f.m.readAt ? [(f.m.readAt.getTime() - f.m.sentAt.getTime()) / MINUTE] : []);
  const readClosed = firsts.filter(f => f.m.readAt && closed(f.m));
  const readNoReply = readClosed.filter(f => !repliedAfter(f.id, f.m)).length;
  const readToReply = readClosed.flatMap(f => {
    const reply = (byCustomer.get(f.id) ?? []).find(x => x.direction === 'INBOUND' && x.sentAt > f.m.sentAt);
    return reply && f.m.readAt && reply.sentAt >= f.m.readAt ? [(reply.sentAt.getTime() - f.m.readAt.getTime()) / MINUTE] : [];
  });

  // 5. 广告: which ad each customer came from; spend from Meta's per-country, per-ad daily rows.
  const ads = await adsFor(ab, code, period, zone, timezone);

  // 6. 需求画像 of effective customers (confirmed values only).
  const demandRows = effective.length ? await db.customerDemandField.findMany({ where: { customerId: { in: effective.map(c => c.id) }, status: 'CONFIRMED' }, select: { customerId: true, field: true, value: true } }) : [];
  const profiled = new Set(demandRows.map(r => r.customerId)).size;
  const needs = (['category', 'size', 'quantity', 'buyer', 'packaging', 'port'] as const).map(field => {
    const counts = new Map<string, number>();
    for (const r of demandRows.filter(d => d.field === field)) counts.set(r.value, (counts.get(r.value) ?? 0) + 1);
    const total = [...counts.values()].reduce((s, n) => s + n, 0);
    const top = [...counts].sort((a, b) => b[1] - a[1]);
    const parts = top.slice(0, 3).map(([value, n]) => ({ value, n, share: pct(n, total) ?? 0 }));
    const rest = top.slice(3).reduce((s, [, n]) => s + n, 0);
    return { field, label: DEMAND_FIELDS[field], total, parts: rest ? [...parts, { value: '其他', n: rest, share: pct(rest, total) ?? 0 }] : parts };
  }).filter(n => n.total > 0);

  // 7. 成交周期 and value per effective customer, over the last 12 months (more deals to read from).
  const rate = (currency: string) => currency === 'CNY' ? 1 : currency === 'USD' ? Number(settings.usdCnyRate) : currency === 'EUR' && settings.eurCnyRate ? Number(settings.eurCnyRate) : null;
  const firstDeals = yearRows.flatMap(c => c.deals.length ? [{ c, deal: c.deals[0] }] : []);
  const cycleDays = firstDeals.map(({ c, deal }) => Math.max(0, Math.round((deal.dealDate.getTime() - entryOf(c, timezone).at.getTime()) / DAY)));
  const firstAmounts = firstDeals.flatMap(({ deal }) => { const r = rate(deal.currency); return r === null ? [] : [Number(deal.dealAmount) * r]; });
  const profitCny = yearRows.reduce((sum, c) => sum + c.deals.reduce((s, d) => { const r = rate(d.currency); return s + (r === null ? 0 : Number(d.grossProfit) * r); }, 0), 0);
  const yearEffective = yearRows.filter(c => isGoodGrade(c.leadGrade) && isEffective(c)).length;
  const cycle = { deals: firstDeals.length, medianDays: median(cycleDays), medianFirstAmount: median(firstAmounts.map(Math.round)),
    profitPerEffective: yearEffective && profitCny > 0 ? Math.round(profitCny / yearEffective) : null, yearEffective };

  // 8. 流失原因 (picked when the stage changed to 已流失 / 暂不需要), 12 months.
  const lostRows = yearRows.filter(c => ['LOST', 'PAUSED'].includes(c.stage));
  const lostCounts = new Map<string, number>();
  for (const c of lostRows) { const reason = lossReasonOf(c.invalidReason) || '没写原因'; lostCounts.set(reason, (lostCounts.get(reason) ?? 0) + 1); }
  const lost = { total: lostRows.length, rows: [...LOSS_REASONS, '没写原因'].map(reason => ({ reason, n: lostCounts.get(reason) ?? 0, share: pct(lostCounts.get(reason) ?? 0, lostRows.length) })).filter(r => r.n > 0).sort((a, b) => b.n - a.n) };

  // Weekday A / B share in the customer's own week.
  const dayGrid = zone ? heat(exact, x => x.entry.at, x => isGoodGrade(x.c.leadGrade), zone) : entryGrid;
  const days = marginals(dayGrid).days.map((d, i) => ({ label: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i], n: d.n, rate: pct(d.hits, d.n) }));
  const offShare = pct(exact.filter(x => companyOff(x.entry.at)).length, exact.length);
  const found = findings({
    country, workText: workHoursText(hours),
    entry: { offN: offAb.length, offEffective: offAb.filter(x => isEffective(x.c)).length, inN: inAb.length, inEffective: inAb.filter(x => isEffective(x.c)).length, offShare },
    send: { best: best && { ...best, localStart: localHour(best.start), localEnd: localHour(best.end) }, overall: overallReply, total: sends.length },
    days, follow, speed: { fastN: fast.length, fastRate: pct(fast.filter(r => isEffective(r.c)).length, fast.length), slowN: slow.length, slowRate: pct(slow.filter(r => isEffective(r.c)).length, slow.length) },
  });

  return {
    ...base, empty: false as const,
    kpis: {
      leads: rows.length, ab: ab.length, abShare: pct(ab.length, rows.length), effective: effective.length, effectiveRate: pct(effective.length, ab.length),
      won, wonRate: pct(won, effective.length), spend: ads.spend, currency: ads.currency, perEffective: ads.spend !== null && effective.length ? Math.round(ads.spend / effective.length * 100) / 100 : null,
      contactMedian: median(speedRows.map(r => Math.round(r.minutes))), offShare, exact: exact.length,
    },
    findings: found, minGroup: MIN_GROUP,
    entryMap: { rows: gridView(entryGrid, offOf), n: exact.length, skipped: rows.length - exact.length },
    sendMap: { rows: gridView(sendGrid, offOf), n: sends.length, overall: overallReply, best: best && { ...best, localStart: localHour(best.start), localEnd: localHour(best.end) } },
    speed, offEntry: { n: offAb.length, effectiveRate: pct(offAb.filter(x => isEffective(x.c)).length, offAb.length), medianWait: median(offWaits.map(Math.round)), inRate: pct(inAb.filter(x => isEffective(x.c)).length, inAb.length) },
    days, follow, read: { n: firsts.length, withReceipt: readMinutes.length, medianToRead: median(readMinutes.map(Math.round)), readNoReply: pct(readNoReply, readClosed.length), readClosed: readClosed.length, medianReadToReply: median(readToReply.map(Math.round)) },
    ads, needs, profiled, cycle, lost,
    holidays: code ? upcomingHolidays(code, dayKey(now, timezone)) : [],
  };
}
export type CountryCard = Awaited<ReturnType<typeof countryCard>>;

/** Some instant whose weekday and hour in `zone` are the given ones, within the last weeks (for reading it in another zone). */
function sampleInstant(weekday: number, hour: number, zone: string, now: Date) {
  for (let back = 0; back < 14 * 24; back++) {
    const at = new Date(now.getTime() - back * 3_600_000);
    const c = clockIn(at, zone);
    if (c.weekday === weekday && c.hour === hour) return at;
  }
  return null;
}

/**
 * Ads for one country: customers by the ad they first came from, and — when Meta's per-country rows are synced —
 * what each ad spent in this country, so each effective customer has a cost. Hourly spend (account time zone) is
 * shared out to the country by each ad's share of spend there, and grouped by the customer's local time of day.
 */
async function adsFor(ab: Row[], code: string, period: { start: Date; end: Date }, zone: string | null, timezone: string) {
  const attributions = ab.length ? await db.customerLeadAttribution.findMany({ where: { customerId: { in: ab.map(c => c.id) } }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    select: { customerId: true, adId: true, adName: true, campaignName: true, occurredAt: true } }) : [];
  const adOf = new Map<string, { adId: string | null; name: string }>();
  for (const a of attributions) if (a.customerId && !adOf.has(a.customerId)) adOf.set(a.customerId, { adId: a.adId, name: a.adName || a.campaignName || a.adId || '—' });
  const day = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
  const countryRows = code ? await db.adDailyMetric.findMany({ where: { grain: 'COUNTRY', country: code, metricDate: { gte: day(period.start), lte: day(period.end) } },
    select: { adId: true, spend: true, currency: true, metricDate: true, accountId: true } }) : [];
  const byCurrency = new Map<string, number>();
  for (const r of countryRows) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + Number(r.spend));
  const currency = [...byCurrency].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const spendRows = countryRows.filter(r => r.currency === currency);
  const spendByAd = new Map<string, number>();
  for (const r of spendRows) spendByAd.set(r.adId, (spendByAd.get(r.adId) ?? 0) + Number(r.spend));
  const spend = spendRows.length ? Math.round(spendRows.reduce((s, r) => s + Number(r.spend), 0) * 100) / 100 : null;

  const groups = new Map<string, { key: string; name: string; ab: number; effective: number; won: number }>();
  for (const c of ab) {
    const a = adOf.get(c.id);
    if (!a) continue;
    const key = a.adId ?? a.name;
    const g = groups.get(key) ?? { key, name: a.name, ab: 0, effective: 0, won: 0 };
    g.ab++; if (isEffective(c)) { g.effective++; if (funnelDepth(c) >= 5) g.won++; }
    groups.set(key, g);
  }
  const effectiveTotal = ab.filter(isEffective).length;
  const overall = spend !== null && effectiveTotal ? spend / effectiveTotal : null;
  const list = [...groups.values()].map(g => {
    const adSpend = spendByAd.get(g.key) ?? null;
    return { ...g, rate: pct(g.effective, g.ab), spend: adSpend === null ? null : Math.round(adSpend * 100) / 100,
      perEffective: adSpend !== null && g.effective ? Math.round(adSpend / g.effective * 100) / 100 : null };
  }).sort((a, b) => b.effective - a.effective || b.ab - a.ab).slice(0, 10);

  // Time of day (customer's local time): spend shared to the country, and effective customers by entry hour.
  let slots: { label: string; spendShare: number | null; effectiveShare: number | null; perEffective: number | null }[] = [];
  const adIds = [...spendByAd.keys()];
  if (zone && adIds.length) {
    const [hourly, totals, accounts] = await Promise.all([
      db.adHourlyMetric.findMany({ where: { adId: { in: adIds }, metricDate: { gte: day(period.start), lte: day(period.end) }, currency: currency ?? undefined }, select: { adId: true, accountId: true, metricDate: true, hour: true, spend: true } }),
      db.adDailyMetric.findMany({ where: { grain: 'AD', adId: { in: adIds }, metricDate: { gte: day(period.start), lte: day(period.end) } }, select: { adId: true, spend: true } }),
      db.metaAdAccount.findMany({ select: { externalId: true, timezone: true } }),
    ]);
    if (hourly.length) {
      const adTotal = new Map<string, number>();
      for (const t of totals) adTotal.set(t.adId, (adTotal.get(t.adId) ?? 0) + Number(t.spend));
      const accountZone = new Map(accounts.map(a => [a.externalId.replace(/^act_/, ''), a.timezone || timezone]));
      const SLOTS = [{ label: '夜里 0–6 点', from: 0, to: 6 }, { label: '上午 6–12 点', from: 6, to: 12 }, { label: '下午 12–18 点', from: 12, to: 18 }, { label: '晚上 18–24 点', from: 18, to: 24 }];
      const slotOf = (h: number) => SLOTS.findIndex(s => h >= s.from && h < s.to);
      const slotSpend = SLOTS.map(() => 0);
      for (const h of hourly) {
        const share = (spendByAd.get(h.adId) ?? 0) / (adTotal.get(h.adId) || Infinity);
        if (!share) continue;
        const accountTz = accountZone.get(h.accountId.replace(/^act_/, '')) ?? timezone;
        const instant = localDate(`${h.metricDate.toISOString().slice(0, 10)}T${String(h.hour).padStart(2, '0')}:00`, accountTz);
        slotSpend[slotOf(clockIn(instant, zone).hour)] += Number(h.spend) * share;
      }
      const effectiveEntries = ab.filter(isEffective).map(c => entryOf(c, timezone)).filter(e => e.exact);
      const slotEffective = SLOTS.map(() => 0);
      for (const e of effectiveEntries) slotEffective[slotOf(clockIn(e.at, zone).hour)]++;
      const totalSpend = slotSpend.reduce((s, v) => s + v, 0);
      slots = SLOTS.map((s, i) => ({ label: s.label, spendShare: pct(slotSpend[i], totalSpend), effectiveShare: pct(slotEffective[i], effectiveEntries.length),
        perEffective: slotEffective[i] ? Math.round(slotSpend[i] / slotEffective[i] * 100) / 100 : null }));
    }
  }
  return { currency, spend, synced: countryRows.length > 0, overallPerEffective: overall === null ? null : Math.round(overall * 100) / 100, list, slots, hourlySynced: slots.length > 0 };
}
