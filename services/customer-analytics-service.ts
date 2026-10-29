import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { bucketIndex, changeRate, cockpitSelection, periodPair, rate, trendBuckets } from '@/lib/business-cockpit';
import { sources as SOURCE_LABELS } from '@/lib/constants';
import { inquiryDate } from '@/lib/customer-date';
import { inquiryIn, isQualified } from '@/lib/metrics';
import { dayKey, localDate } from '@/lib/time';
import {
  FUNNEL_STEPS, GRADE_KEYS, STATUSES, customerStatus, firstContact, funnelCounts, funnelDepth, gradeChange, gradeKey, gradeLabel,
  isGoodGrade, median, pointsBetween, weakestStep, type GradeKey, type Status,
} from '@/lib/analytics';

/** Filters on top of the period. A wrong value in a hand-edited link falls back to 全部 instead of failing the page. */
const filterSchema = z.object({
  owner: z.string().trim().max(191).catch(''),
  source: z.string().trim().max(40).catch(''),
  country: z.string().trim().max(100).catch(''),
  grade: z.enum(['', 'A', 'B', 'C', 'D', 'none']).catch(''),
});
export type CustomerAnalyticsFilters = z.infer<typeof filterSchema>;
type Query = Parameters<typeof cockpitSelection>[0] & Partial<Record<keyof CustomerAnalyticsFilters, string>>;

const select = {
  id: true, ownerId: true, pendingAssignment: true, leadGrade: true, leadGradeSource: true, leadGradeReason: true, source: true, country: true,
  stage: true, isQualified: true, contactedAt: true, firstContactAt: true, firstContactDueAt: true, assignedAt: true, lastOutboundAt: true,
  lastFollowUpAt: true, needsConfirmedAt: true, quotedAt: true, outreachState: true, inquiryAt: true, createdAt: true,
  quotations: { where: { status: 'SENT' }, select: { id: true }, take: 1 }, deals: { select: { id: true }, take: 1 },
} satisfies Prisma.CustomerSelect;
type Row = Prisma.CustomerGetPayload<{ select: typeof select }>;

const matches = (f: CustomerAnalyticsFilters) => (c: Row) =>
  (!f.owner || c.ownerId === f.owner) && (!f.source || c.source === f.source) && (!f.country || c.country === f.country)
  && (!f.grade || c.leadGrade === (f.grade === 'none' ? '' : f.grade));
const sourceLabel = (key: string) => key ? SOURCE_LABELS[key as keyof typeof SOURCE_LABELS] ?? key : '未填写';

/** Funnel step hints: where to look first when a step loses the most. Rules, not AI. */
const STEP_HINTS = ['', '先看首联是否及时', '先看破冰话术与首联时效', '先看需求沟通是否问清', '先看报价是否及时', '先看报价后的跟进'];

/**
 * 客户分析: the leads whose inquiry falls in the period (lib/metrics inquiryIn, the cockpit's 新增询盘) — how many of
 * each grade came, how far each grade got (the furthest step ever reached, lib/analytics funnelDepth), where they are
 * now, and which sources, countries and owners bring the good ones. Compared with the period of the same length
 * before it. Read only.
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
  const keep = matches(filters);
  const customers = all.filter(keep), earlier = before.filter(keep);
  const ownerIds = [...new Set(all.map(c => c.ownerId))];
  const people = await db.user.findMany({ where: { OR: [{ id: { in: ownerIds } }, { isActive: true }] }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } });
  const nameOf = new Map(people.map(person => [person.id, person.name]));

  const total = customers.length, previousTotal = earlier.length;
  const gradeCount = (rows: Row[], grade: GradeKey) => rows.filter(c => gradeKey(c.leadGrade) === grade).length;
  const good = customers.filter(c => isGoodGrade(c.leadGrade)).length, previousGood = earlier.filter(c => isGoodGrade(c.leadGrade)).length;
  const qualified = customers.filter(isQualified).length, previousQualified = earlier.filter(isQualified).length;
  const depths = customers.map(funnelDepth), previousDepths = earlier.map(funnelDepth);
  const quoted = depths.filter(depth => depth >= 4).length, won = depths.filter(depth => depth >= 5).length;
  const previousWon = previousDepths.filter(depth => depth >= 5).length;
  const shares = {
    good: rate(good, total), previousGood: rate(previousGood, previousTotal),
    qualified: rate(qualified, total), previousQualified: rate(previousQualified, previousTotal),
    won: rate(won, total), previousWon: rate(previousWon, previousTotal),
  };

  // First contact, A and B leads only: they are the ones with a minutes-long deadline.
  const contactOf = (rows: Row[]) => {
    const results = rows.filter(c => isGoodGrade(c.leadGrade)).map(c => firstContact(c, now)).filter(result => result !== null);
    const onTime = results.filter(result => result.onTime).length;
    return { onTime, late: results.length - onTime, rate: rate(onTime, results.length), overdue: results.filter(result => result.overdue).length,
      medianMinutes: median(results.flatMap(result => result.minutes === null ? [] : [result.minutes])) };
  };

  // Leads per day (week, month) and grade.
  const chartCustomers = (chartRows ?? all).filter(keep);
  const daily = buckets.map(bucket => ({ ...bucket, A: 0, B: 0, C: 0, other: 0 }));
  for (const c of chartCustomers) {
    const index = bucketIndex(buckets, dayKey(inquiryDate(c), timezone));
    if (index < 0) continue;
    const grade = gradeKey(c.leadGrade);
    if (grade === 'A' || grade === 'B' || grade === 'C') daily[index][grade]++; else daily[index].other++;
  }

  // Funnel per grade. D and 未评级 share a row: neither gets a script.
  const rowsOf = [
    { key: 'A', label: 'A', rows: customers.filter(c => c.leadGrade === 'A') },
    { key: 'B', label: 'B', rows: customers.filter(c => c.leadGrade === 'B') },
    { key: 'C', label: 'C', rows: customers.filter(c => c.leadGrade === 'C') },
    { key: 'other', label: 'D / 未评级', rows: customers.filter(c => !['A', 'B', 'C'].includes(c.leadGrade)) },
  ];
  const funnelRows = rowsOf.map(row => {
    const counts = funnelCounts(row.rows.map(funnelDepth));
    return { key: row.key, label: row.label, counts, weakest: row.key === 'other' ? -1 : weakestStep(counts) };
  });
  const allCounts = funnelCounts(depths);
  // The insight: the graded row and step that keep the fewest, among steps with enough customers to judge.
  const worst = funnelRows.filter(row => row.key !== 'other').flatMap(row => {
    const step = weakestStep(row.counts, 5);
    return step < 0 ? [] : [{ row, step, kept: rate(row.counts[step], row.counts[step - 1])! }];
  }).sort((a, b) => a.kept - b.kept)[0];
  const insight = worst ? `${worst.row.label} 类在「${FUNNEL_STEPS[worst.step - 1]} → ${FUNNEL_STEPS[worst.step]}」只留下 ${worst.kept}%，是各等级里掉得最多的一步：${STEP_HINTS[worst.step]}。` : null;

  // Where they are now.
  const statusCounts = new Map<Status, number>();
  for (const c of customers) { const status = customerStatus(c); statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1); }
  const statuses = (Object.keys(STATUSES) as Status[]).map(key => ({ key, label: STATUSES[key], count: statusCounts.get(key) ?? 0, share: rate(statusCounts.get(key) ?? 0, total) }))
    .filter(status => status.count > 0).sort((a, b) => b.count - a.count);

  // Sources and countries: the grade mix and how many became 有效. Past `limit`, the rest is one row.
  const breakdown = (field: 'source' | 'country', label: (key: string) => string, limit: number, rest: string) => {
    const groups = new Map<string, Row[]>();
    for (const c of customers) { const key = c[field].trim(); groups.set(key, [...groups.get(key) ?? [], c]); }
    const ranked = [...groups].map(([key, rows]) => ({ key, label: label(key), rows, filterable: key !== '' }))
      .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label, 'zh-CN'));
    const shown = ranked.length > limit + 1 ? [...ranked.slice(0, limit), { key: '', label: rest, rows: ranked.slice(limit).flatMap(group => group.rows), filterable: false }] : ranked;
    return shown.map(({ key, label: name, rows, filterable }) => ({ key, label: name, total: rows.length, filterable,
      A: gradeCount(rows, 'A'), B: gradeCount(rows, 'B'), C: gradeCount(rows, 'C'), other: gradeCount(rows, 'D') + gradeCount(rows, ''),
      qualifiedRate: rate(rows.filter(isQualified).length, rows.length) }));
  };

  // Owners. Leads still in the pool sit on the intake administrator, so they get their own row.
  const ownerRows = new Map<string, Row[]>();
  for (const c of customers) { const key = c.pendingAssignment ? 'pool' : c.ownerId; ownerRows.set(key, [...ownerRows.get(key) ?? [], c]); }
  const owners = [...ownerRows].map(([id, rows]) => {
    const rowDepths = rows.map(funnelDepth), valid = rows.filter(isQualified).length;
    return { id, name: id === 'pool' ? '待分配' : nameOf.get(id) ?? '—', total: rows.length,
      A: gradeCount(rows, 'A'), B: gradeCount(rows, 'B'), C: gradeCount(rows, 'C'), other: gradeCount(rows, 'D') + gradeCount(rows, ''),
      onTimeRate: contactOf(rows).rate, qualified: valid, qualifiedRate: rate(valid, rows.length),
      quoted: rowDepths.filter(depth => depth >= 4).length, won: rowDepths.filter(depth => depth >= 5).length };
  }).sort((a, b) => Number(a.id === 'pool') - Number(b.id === 'pool') || b.total - a.total);

  // Who graded them, and how people changed the automatic grades.
  const changes = new Map<string, number>();
  for (const c of customers) {
    if (c.leadGradeSource !== 'HUMAN') continue;
    const change = gradeChange(c.leadGradeReason, c.leadGrade);
    if (change) changes.set(`${change.from} → ${change.to}`, (changes.get(`${change.from} → ${change.to}`) ?? 0) + 1);
  }
  const humanGraded = customers.filter(c => c.leadGradeSource === 'HUMAN').length;
  const grading = {
    ai: customers.filter(c => c.leadGrade && c.leadGradeSource === 'AI').length,
    rule: customers.filter(c => c.leadGrade && c.leadGradeSource === 'RULE').length,
    human: humanGraded, changed: [...changes.values()].reduce((sum, count) => sum + count, 0),
    ungraded: customers.filter(c => !c.leadGrade).length,
    changes: [...changes].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };

  const countryKeys = [...new Set(all.map(c => c.country.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const sourceKeys = [...new Set(all.map(c => c.source))].sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b), 'zh-CN'));
  return {
    selected: { range: selected.range, startKey: selected.startKey, endKey: selected.endKey, label: selected.label, trend: selected.trend },
    filters,
    options: {
      owners: people.filter(person => person.isActive || ownerIds.includes(person.id)).map(person => ({ id: person.id, name: person.name })),
      sources: sourceKeys.map(key => ({ key, label: sourceLabel(key) })),
      countries: countryKeys,
    },
    total, previousTotal, totalChange: changeRate(total, previousTotal),
    grades: GRADE_KEYS.map(grade => {
      const count = gradeCount(customers, grade), was = gradeCount(earlier, grade);
      return { key: grade || 'none', label: gradeLabel(grade), count, share: rate(count, total), previous: was, change: count - was };
    }),
    good: { count: good, share: shares.good, previousShare: shares.previousGood, points: pointsBetween(shares.good, shares.previousGood) },
    qualified: { count: qualified, rate: shares.qualified, previousRate: shares.previousQualified, points: pointsBetween(shares.qualified, shares.previousQualified) },
    quoted, won, wonRate: shares.won, previousWonRate: shares.previousWon, wonPoints: pointsBetween(shares.won, shares.previousWon),
    firstContact: contactOf(customers),
    daily: { label: selected.range === 'today' ? '近 7 天（含今日）' : `${selected.startKey} — ${selected.endKey}`, view: selected.trend,
      points: daily.map(point => ({ label: point.label, start: point.start, end: point.end, A: point.A, B: point.B, C: point.C, other: point.other })) },
    funnel: { steps: [...FUNNEL_STEPS], rows: [...funnelRows, { key: 'all', label: '全部', counts: allCounts, weakest: -1 }], insight },
    statuses,
    sources: breakdown('source', sourceLabel, 5, '其余来源'),
    countries: breakdown('country', key => key || '未填写', 7, '其余国家'),
    owners,
    grading,
  };
}
export type CustomerAnalytics = Awaited<ReturnType<typeof customerAnalytics>>;
