import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { bucketIndex, changeRate, cockpitSelection, periodPair, rate, trendBuckets } from '@/lib/business-cockpit';
import { sources as SOURCE_LABELS } from '@/lib/constants';
import { inquiryDate } from '@/lib/customer-date';
import { inquiryIn } from '@/lib/metrics';
import { dayKey, localDate } from '@/lib/time';
import { EFFECTIVE_STEPS, GRADE_KEYS, customerStatus, firstContact, funnelDepth, gradeKey, gradeLabel, isEffective, isGoodGrade, median, pointsBetween, wasContacted, type GradeKey } from '@/lib/analytics';

/** Filters on top of the period. The page is about A and B; a wrong value in a hand-edited link falls back to A + B. */
const filterSchema = z.object({
  owner: z.string().trim().max(191).catch(''),
  source: z.string().trim().max(40).catch(''),
  country: z.string().trim().max(100).catch(''),
  grade: z.enum(['', 'A', 'B']).catch(''),
});
export type CustomerAnalyticsFilters = z.infer<typeof filterSchema>;
type Query = Parameters<typeof cockpitSelection>[0] & Partial<Record<keyof CustomerAnalyticsFilters, string>>;

const HOUR = 3600_000, DAY = 24 * HOUR;
const PEOPLE_LIMIT = 50;
const select = {
  id: true, name: true, ownerId: true, pendingAssignment: true, leadGrade: true, source: true, country: true,
  stage: true, isQualified: true, contactedAt: true, firstContactAt: true, firstContactDueAt: true, assignedAt: true, lastOutboundAt: true,
  lastInboundAt: true, lastFollowUpAt: true, needsConfirmedAt: true, quotedAt: true, outreachState: true, inquiryAt: true, createdAt: true,
  quotations: { where: { status: 'SENT' }, select: { id: true }, take: 1 }, deals: { select: { id: true }, take: 1 },
} satisfies Prisma.CustomerSelect;
type Row = Prisma.CustomerGetPayload<{ select: typeof select }>;
type Attribution = { campaignId: string | null; campaignName: string | null; adsetId: string | null; adsetName: string | null; adId: string | null; adName: string | null };

/** Owner, source and country narrow every number; the grade (A, B or both) narrows the A / B and 有效 ones. */
const inFilters = (f: CustomerAnalyticsFilters) => (c: Row) =>
  (!f.owner || c.ownerId === f.owner) && (!f.source || c.source === f.source) && (!f.country || c.country === f.country);
const inGrade = (f: CustomerAnalyticsFilters) => (c: Row) => f.grade ? c.leadGrade === f.grade : isGoodGrade(c.leadGrade);
const sourceLabel = (key: string) => key ? SOURCE_LABELS[key as keyof typeof SOURCE_LABELS] ?? key : '未填写';
const waitingForUs = (c: Row) => !!c.lastInboundAt && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt);

/**
 * 客户分析 (docs/METRICS.md §客户分析): the leads whose inquiry falls in the period. Only 新增线索 counts every lead;
 * everything else is about 有效客户 — A / B leads who answered after our first message (lib/analytics isEffective):
 * how many A / B came, how many became effective and how far they got, which sources, countries and owners bring
 * them, and what each effective customer cost in ads. Compared with the period of the same length before it. Read only.
 */
export async function customerAnalytics(user: Actor, query: Query = {}, now = new Date()) {
  const filters = filterSchema.parse(query);
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const timezone = settings.timezone;
  const selected = cockpitSelection(query, timezone, now);
  const { current, previous } = periodPair(selected, now);
  const buckets = trendBuckets(selected);
  const chartStart = localDate(`${selected.trendStartKey}T00:00`, timezone);
  const customerScope = scope(user);
  const [all, before, chartRows] = await Promise.all([
    db.customer.findMany({ where: { AND: [customerScope, inquiryIn(current)] }, select }),
    db.customer.findMany({ where: { AND: [customerScope, inquiryIn(previous)] }, select }),
    // Today's chart shows the last seven days, so it needs the days before the period too.
    chartStart < current.start
      ? db.customer.findMany({ where: { AND: [customerScope, inquiryIn({ start: chartStart, end: current.end })] }, select })
      : Promise.resolve(null),
  ]);
  const keep = inFilters(filters), graded = inGrade(filters);
  const customers = all.filter(keep), earlier = before.filter(keep);
  const ab = customers.filter(graded), abBefore = earlier.filter(graded);
  const effective = ab.filter(isEffective), effectiveBefore = abBefore.filter(isEffective);
  const ownerIds = [...new Set(all.map(c => c.ownerId))];
  const [people, attributions, lastMessages] = await Promise.all([
    db.user.findMany({ where: { OR: [{ id: { in: ownerIds } }, { isActive: true }] }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
    // The ad a customer first came from: a lead form or a click-to-WhatsApp chat.
    db.customerLeadAttribution.findMany({ where: { customerId: { in: [...all, ...before].map(c => c.id) } }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      select: { customerId: true, campaignId: true, campaignName: true, adsetId: true, adsetName: true, adId: true, adName: true } }),
    db.whatsAppMessage.findMany({ where: { customerId: { in: effective.slice(0, PEOPLE_LIMIT * 2).map(c => c.id) }, status: { notIn: ['FAILED', 'PENDING'] } },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], distinct: ['customerId'], select: { customerId: true, sentAt: true, direction: true } }),
  ]);
  const nameOf = new Map(people.map(person => [person.id, person.name]));
  const adOf = new Map<string, Attribution>();
  for (const a of attributions) if (a.customerId && !adOf.has(a.customerId)) adOf.set(a.customerId, a);
  const lastOf = new Map(lastMessages.map(m => [m.customerId, m]));

  const total = customers.length, previousTotal = earlier.length;
  const gradeCount = (rows: Row[], grade: GradeKey) => rows.filter(c => gradeKey(c.leadGrade) === grade).length;
  const depths = effective.map(funnelDepth), depthsBefore = effectiveBefore.map(funnelDepth);
  const quoted = depths.filter(depth => depth >= 4).length, won = depths.filter(depth => depth >= 5).length;
  const abShare = rate(ab.length, total), abSharePrevious = rate(abBefore.length, previousTotal);
  const effectiveRate = rate(effective.length, ab.length), effectiveRatePrevious = rate(effectiveBefore.length, abBefore.length);

  // First contact, A and B leads only: they are the ones with a minutes-long deadline.
  const contactOf = (rows: Row[]) => {
    const results = rows.filter(c => isGoodGrade(c.leadGrade)).map(c => firstContact(c, now)).filter(result => result !== null);
    const onTime = results.filter(result => result.onTime).length;
    return { onTime, late: results.length - onTime, rate: rate(onTime, results.length), overdue: results.filter(result => result.overdue).length,
      medianMinutes: median(results.flatMap(result => result.minutes === null ? [] : [result.minutes])) };
  };

  // A / B leads per day (week, month): the effective ones by grade, and those who have not answered yet.
  const chartCustomers = (chartRows ?? all).filter(keep).filter(graded);
  const daily = buckets.map(bucket => ({ label: bucket.label, start: bucket.start, end: bucket.end, A: 0, B: 0, waiting: 0, spend: 0 }));
  for (const c of chartCustomers) {
    const index = bucketIndex(buckets, dayKey(inquiryDate(c), timezone));
    if (index < 0) continue;
    if (!isEffective(c)) daily[index].waiting++; else if (c.leadGrade === 'A') daily[index].A++; else daily[index].B++;
  }

  // A / B we reached out to who have not answered: the step that loses the most.
  const unanswered = ab.filter(c => wasContacted(c) && !isEffective(c));
  const contactedAt = (c: Row) => c.firstContactAt ?? c.contactedAt ?? c.lastOutboundAt ?? c.lastFollowUpAt;
  const stuck = { count: unanswered.length, overTwoDays: unanswered.filter(c => { const at = contactedAt(c); return !!at && now.getTime() - at.getTime() > 2 * DAY; }).length };

  // Sources, countries and owners: how many A / B, how many became effective, and deals.
  const breakdown = (rows: Row[], keyOf: (c: Row) => string, label: (key: string) => string, limit: number, rest: string) => {
    const groups = new Map<string, Row[]>();
    for (const c of rows) { const key = keyOf(c); groups.set(key, [...groups.get(key) ?? [], c]); }
    const ranked = [...groups].map(([key, list]) => {
      const ok = list.filter(isEffective);
      return { key, label: label(key), filterable: key !== '', ab: list.length, effective: ok.length, rate: rate(ok.length, list.length), won: ok.filter(c => funnelDepth(c) >= 5).length };
    }).sort((a, b) => b.effective - a.effective || b.ab - a.ab || a.label.localeCompare(b.label, 'zh-CN'));
    if (ranked.length <= limit + 1) return ranked;
    const tail = ranked.slice(limit), sum = (key: 'ab' | 'effective' | 'won') => tail.reduce((n, row) => n + row[key], 0);
    return [...ranked.slice(0, limit), { key: '', label: rest, filterable: false, ab: sum('ab'), effective: sum('effective'), rate: rate(sum('effective'), sum('ab')), won: sum('won') }];
  };
  const ownerKey = (c: Row) => c.pendingAssignment ? 'pool' : c.ownerId;

  const ads = await adEffect(all.filter(graded), before.filter(graded), all.length, { current, previous }, adOf, buckets, daily);

  const countryKeys = [...new Set(all.map(c => c.country.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const sourceKeys = [...new Set(all.map(c => c.source))].sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b), 'zh-CN'));
  return {
    selected: { range: selected.range, startKey: selected.startKey, endKey: selected.endKey, label: selected.label, trend: selected.trend },
    filters, timezone,
    options: {
      owners: people.filter(person => person.isActive || ownerIds.includes(person.id)).map(person => ({ id: person.id, name: person.name })),
      sources: sourceKeys.map(key => ({ key, label: sourceLabel(key) })),
      countries: countryKeys,
    },
    // 新增线索: every lead, whatever the grade.
    total, previousTotal, totalChange: changeRate(total, previousTotal),
    grades: GRADE_KEYS.map(grade => ({ key: grade || 'none', label: gradeLabel(grade), count: gradeCount(customers, grade) })),
    ab: { count: ab.length, A: gradeCount(ab, 'A'), B: gradeCount(ab, 'B'), share: abShare, previousShare: abSharePrevious, points: pointsBetween(abShare, abSharePrevious) },
    effective: { count: effective.length, A: gradeCount(effective, 'A'), B: gradeCount(effective, 'B'), previous: effectiveBefore.length,
      rate: effectiveRate, previousRate: effectiveRatePrevious, points: pointsBetween(effectiveRate, effectiveRatePrevious) },
    quoted, won, quotedRate: rate(quoted, effective.length), wonRate: rate(won, effective.length),
    previousQuoted: depthsBefore.filter(depth => depth >= 4).length, previousWon: depthsBefore.filter(depth => depth >= 5).length,
    // Where the new leads went: effective, A / B not (yet) effective, C and D, ungraded.
    spread: { effective: effective.length, waiting: ab.length - effective.length,
      other: customers.filter(c => !graded(c) && gradeKey(c.leadGrade) !== '').length, ungraded: gradeCount(customers, '') },
    firstContact: contactOf(customers),
    waitingForUs: { count: effective.filter(waitingForUs).length, overTwoHours: effective.filter(c => waitingForUs(c) && now.getTime() - c.lastInboundAt!.getTime() > 2 * HOUR).length },
    stuck,
    daily: { label: selected.range === 'today' ? '近 7 天（含今日）' : `${selected.startKey} — ${selected.endKey}`, view: selected.trend, points: daily },
    steps: ([2, 3, 4, 5] as const).map(depth => ({ depth, label: EFFECTIVE_STEPS[depth], count: depths.filter(d => d === depth).length })),
    lost: effective.filter(c => ['LOST', 'INVALID'].includes(customerStatus(c))).length,
    sources: breakdown(ab, c => c.source, sourceLabel, 5, '其余来源'),
    countries: breakdown(ab, c => c.country.trim(), key => key || '未填写', 5, '其余国家'),
    owners: breakdown(ab, ownerKey, key => key === 'pool' ? '待分配' : nameOf.get(key) ?? '—', 8, '其余负责人').map(row => ({ ...row, filterable: row.filterable && row.key !== 'pool' })),
    people: [...effective].sort((a, b) => (lastOf.get(b.id)?.sentAt.getTime() ?? 0) - (lastOf.get(a.id)?.sentAt.getTime() ?? 0)).slice(0, PEOPLE_LIMIT).map(c => {
      const ad = adOf.get(c.id), last = lastOf.get(c.id);
      return { id: c.id, name: c.name, grade: c.leadGrade, country: c.country, owner: c.pendingAssignment ? '待分配' : nameOf.get(c.ownerId) ?? '—',
        from: ad?.adName || ad?.campaignName || sourceLabel(c.source), step: EFFECTIVE_STEPS[funnelDepth(c) as 2 | 3 | 4 | 5] ?? '已回复',
        last: last ? { at: last.sentAt, inbound: last.direction === 'INBOUND' } : null };
    }),
    ads,
  };
}
export type CustomerAnalytics = Awaited<ReturnType<typeof customerAnalytics>>;

/**
 * 广告效果, by effective customer. Spend, impressions, clicks and platform leads come from the Meta sync
 * (MarketingMetric, per campaign per day, in the ad account's currency); which ad a customer came from is their first
 * lead attribution. Spend cannot be split by owner, source or country, so this part leaves those filters out.
 */
async function adEffect(ab: Row[], abBefore: Row[], leads: number, periods: { current: { start: Date; end: Date }; previous: { start: Date; end: Date } },
  adOf: Map<string, Attribution>, buckets: ReturnType<typeof trendBuckets>, daily: { spend: number }[]) {
  const metrics = (period: { start: Date; end: Date }) => db.marketingMetric.findMany({ where: { metricDate: { gte: period.start, lt: period.end } },
    select: { metricDate: true, spend: true, impressions: true, clicks: true, leads: true, campaign: { select: { id: true, externalId: true, name: true, currency: true } } } });
  const [now, before] = await Promise.all([metrics(periods.current), metrics(periods.previous)]);
  // One currency is shown: the one most of the money was spent in (the ad account's).
  const byCurrency = new Map<string, number>();
  for (const m of now) byCurrency.set(m.campaign.currency, (byCurrency.get(m.campaign.currency) ?? 0) + Number(m.spend));
  const currency = [...byCurrency].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const other = [...byCurrency.keys()].filter(code => code !== currency);
  const inCurrency = <T extends { campaign: { currency: string } }>(rows: T[]) => rows.filter(m => m.campaign.currency === currency);
  const spendOf = (rows: { spend: Prisma.Decimal }[]) => Math.round(rows.reduce((sum, m) => sum + Number(m.spend), 0) * 100) / 100;
  const nowRows = inCurrency(now), beforeRows = inCurrency(before);
  const spend = spendOf(nowRows), previousSpend = spendOf(beforeRows);
  for (const m of nowRows) {
    const index = bucketIndex(buckets, m.metricDate.toISOString().slice(0, 10));
    if (index >= 0) daily[index].spend = Math.round((daily[index].spend + Number(m.spend)) * 100) / 100;
  }
  const effective = ab.filter(isEffective), effectiveBefore = abBefore.filter(isEffective);
  const won = effective.filter(c => funnelDepth(c) >= 5).length;
  const cost = (amount: number, count: number) => count > 0 && amount > 0 ? Math.round(amount / count * 100) / 100 : null;

  // Campaigns: spend from the sync, customers by the campaign they came from.
  const campaigns = new Map<string, { key: string; name: string; spend: number; ab: number; effective: number; won: number }>();
  for (const m of nowRows) {
    const key = m.campaign.externalId || m.campaign.id;
    const row = campaigns.get(key) ?? { key, name: m.campaign.name, spend: 0, ab: 0, effective: 0, won: 0 };
    row.spend = Math.round((row.spend + Number(m.spend)) * 100) / 100;
    campaigns.set(key, row);
  }
  const level = (field: 'campaign' | 'adset' | 'ad') => {
    const rows = new Map<string, { key: string; name: string; ab: number; effective: number; won: number }>();
    for (const c of ab) {
      const a = adOf.get(c.id);
      const id = a?.[`${field}Id`], name = a?.[`${field}Name`];
      if (!id) continue;
      const row = rows.get(id) ?? { key: id, name: name || id, ab: 0, effective: 0, won: 0 };
      row.ab++;
      if (isEffective(c)) { row.effective++; if (funnelDepth(c) >= 5) row.won++; }
      rows.set(id, row);
    }
    return rows;
  };
  for (const [key, row] of level('campaign')) {
    const target = campaigns.get(key) ?? { key, name: row.name, spend: 0, ab: 0, effective: 0, won: 0 };
    campaigns.set(key, { ...target, ab: row.ab, effective: row.effective, won: row.won });
  }
  const conversions = (rows: Map<string, { key: string; name: string; ab: number; effective: number; won: number }>) => [...rows.values()]
    .map(row => ({ ...row, rate: rate(row.effective, row.ab) })).sort((a, b) => b.effective - a.effective || b.ab - a.ab).slice(0, 12);
  const attributed = ab.filter(c => adOf.get(c.id)?.campaignId).length;
  return {
    currency, otherCurrencies: other,
    spend, previousSpend, impressions: nowRows.reduce((n, m) => n + m.impressions, 0), clicks: nowRows.reduce((n, m) => n + m.clicks, 0),
    platformLeads: nowRows.reduce((n, m) => n + m.leads, 0), leads,
    ab: ab.length, effective: effective.length, won, attributed,
    perAb: cost(spend, ab.length), perEffective: cost(spend, effective.length), previousPerEffective: cost(previousSpend, effectiveBefore.length), perWon: cost(spend, won),
    campaigns: [...campaigns.values()].filter(row => row.spend > 0 || row.ab > 0)
      .map(row => ({ ...row, spendShare: rate(row.spend, spend), effectiveShare: rate(row.effective, effective.length), perEffective: cost(row.spend, row.effective) }))
      .sort((a, b) => b.spend - a.spend || b.effective - a.effective),
    adsets: conversions(level('adset')),
    ads: conversions(level('ad')),
  };
}
