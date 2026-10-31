import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { bucketIndex, changeRate, cockpitSelection, periodPair, rate, trendBuckets } from '@/lib/business-cockpit';
import { TERMINAL_STAGES } from '@/lib/constants';
import { countryTimezone } from '@/lib/country-timezone';
import { QUALIFIED } from '@/lib/metrics';
import { countryCodeOf } from '@/lib/phone-country';
import { CHANNELS, groupChannel, groupMessages, readConfig, type Channel, type FlowMessage, type MessageGroup } from '@/lib/outreach';
import { dayKey, localDate } from '@/lib/time';
import { SPEED_BUCKETS, busiestHours, median, responseTurns, speedBucket, weekendDifference } from '@/lib/analytics';

/** Filters on top of the period. The page is about A and B; a wrong value in a hand-edited link falls back to A + B. */
const filterSchema = z.object({
  owner: z.string().trim().max(191).catch(''),
  grade: z.enum(['', 'A', 'B']).catch(''),
  country: z.string().trim().max(100).catch(''),
  channel: z.enum(['', 'BOS_TEMPLATE', 'BOS_FREE', 'PHONE']).catch(''),
  clock: z.enum(['company', 'local']).catch('company'),
});
export type MessageAnalyticsFilters = z.infer<typeof filterSchema>;
type Query = Parameters<typeof cockpitSelection>[0] & Partial<Record<keyof MessageAnalyticsFilters, string>>;

const HOUR = 3600_000, DAY = 24 * HOUR;
/** Messages this long before the period are read too: an answer needs the question. */
const LOOKBACK = 7 * DAY;
/** Waiting for us longer than this is late; no message either way for this long is 没动静. */
const LATE_MS = 2 * HOUR, QUIET_MS = 3 * DAY;
const LIST_LIMIT = 8;

type Turn = { at: Date; minutes: number | null };
const speedOf = (turns: Turn[]) => {
  const decided = turns.filter(turn => turn.minutes !== null).map(turn => turn.minutes!);
  return {
    median: median(decided), decided: decided.length, pending: turns.length - decided.length,
    within5: rate(decided.filter(minutes => minutes <= 5).length, decided.length),
    within60: rate(decided.filter(minutes => minutes <= 60).length, decided.length),
    buckets: SPEED_BUCKETS.map((bucket, index) => {
      const count = decided.filter(minutes => speedBucket(minutes) === index).length;
      return { label: bucket.label, count, share: rate(count, decided.length) };
    }),
  };
};

/**
 * 消息分析 (docs/METRICS.md §消息分析): the WhatsApp chats with 有效客户 only — A / B customers who answered after our
 * first message (the shared 有效 rule) — by the time messages were sent, counted in groups (one side's messages
 * within the outreach setting's minutes of each other are one group). How much each side wrote, how fast we answer,
 * when they write, and where each chat stands now. The 发送方式 filter only narrows the messages we sent. Read only.
 */
export async function messageAnalytics(user: Actor, query: Query = {}, now = new Date()) {
  const filters = filterSchema.parse(query);
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, outreachConfig: true } });
  const { timezone } = setting, config = readConfig(setting.outreachConfig);
  const selected = cockpitSelection(query, timezone, now);
  const { current, previous } = periodPair(selected, now);
  const buckets = trendBuckets(selected);
  const chartStart = localDate(`${selected.trendStartKey}T00:00`, timezone);
  const loadStart = new Date(Math.min(previous.start.getTime(), chartStart.getTime()) - LOOKBACK);
  // A day past the period, so a question asked on its last evening still finds our answer.
  const loadEnd = new Date(Math.min(now.getTime(), current.end.getTime() + DAY + HOUR));
  const customerWhere: Prisma.CustomerWhereInput = { AND: [scope(user), QUALIFIED,
    { leadGrade: filters.grade || { in: ['A', 'B'] } },
    ...(filters.owner ? [{ ownerId: filters.owner }] : []),
    ...(filters.country ? [{ country: filters.country }] : [])] };

  const [rows, effective, people, countryRows] = await Promise.all([
    db.whatsAppMessage.findMany({
      where: { customer: customerWhere, direction: { in: ['INBOUND', 'OUTBOUND'] }, status: { notIn: ['FAILED', 'PENDING'] }, sentAt: { gte: loadStart, lt: loadEnd } },
      select: { id: true, customerId: true, direction: true, sentAt: true, messageType: true, requestId: true, sentById: true },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    }),
    // Every effective customer still being worked: where their chat stands now.
    db.customer.findMany({ where: { AND: [customerWhere, { stage: { notIn: [...TERMINAL_STAGES] } }, { lastInboundAt: { not: null } }] },
      select: { id: true, name: true, leadGrade: true, ownerId: true, pendingAssignment: true, lastInboundAt: true, lastOutboundAt: true } }),
    db.user.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
    db.customer.groupBy({ by: ['country'], where: { AND: [scope(user), { country: { not: '' } }] }, orderBy: { country: 'asc' } }),
  ]);
  const ids = [...new Set(rows.map(row => row.customerId))];
  const [customers, replies] = await Promise.all([
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true, pendingAssignment: true, leadGrade: true, country: true, countryCode: true, whatsapp: true, waId: true, phone: true } }),
    db.outreachReply.findMany({ where: { customerId: { in: ids }, receivedAt: { gte: loadStart, lt: loadEnd } }, select: { groupKey: true, quality: true } }),
  ]);
  const customerOf = new Map(customers.map(c => [c.id, c]));
  const quality = new Map(replies.map(reply => [reply.groupKey, reply.quality]));
  // An auto reply opens the 24-hour window but is not the customer writing.
  const auto = (key: string) => quality.get(key) === 'INVALID';
  const nameOf = new Map(people.map(person => [person.id, person.name]));
  const ownerKey = (c: { ownerId: string; pendingAssignment: boolean }) => c.pendingAssignment ? 'pool' : c.ownerId;

  const messagesOf = new Map<string, FlowMessage[]>();
  for (const row of rows) {
    const list = messagesOf.get(row.customerId) ?? [];
    list.push({ id: row.id, direction: row.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND', sentAt: row.sentAt, content: '', messageType: row.messageType,
      bos: !!row.requestId, templateName: null, senderId: row.sentById });
    messagesOf.set(row.customerId, list);
  }

  const within = (date: Date, period: { start: Date; end: Date }) => date >= period.start && date < period.end;
  const ours = (group: MessageGroup) => !filters.channel || groupChannel(group) === filters.channel;
  const clockLabel = timezone === 'Asia/Shanghai' ? '北京时间' : `${timezone} 时间`;

  const totals = { inbound: 0, previousInbound: 0, outbound: 0, previousOutbound: 0 };
  const inboundCustomers = new Set<string>(), outboundCustomers = new Set<string>();
  const channelGroups: Record<Channel, number> = { BOS_TEMPLATE: 0, BOS_FREE: 0, PHONE: 0 };
  const points = buckets.map(bucket => ({ label: bucket.label, start: bucket.start, end: bucket.end, inbound: 0, outbound: 0, speed: null as number | null }));
  const bucketTurns: number[][] = buckets.map(() => []);
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let unknownZone = 0;
  const turns: Turn[] = [], previousTurns: Turn[] = [];
  const owners = new Map<string, { sent: number; received: number; customers: Set<string>; turns: Turn[] }>();
  const ownerRow = (key: string) => {
    if (!owners.has(key)) owners.set(key, { sent: 0, received: 0, customers: new Set(), turns: [] });
    return owners.get(key)!;
  };

  for (const [customerId, messages] of messagesOf) {
    const c = customerOf.get(customerId);
    if (!c) continue;
    const owner = ownerKey(c);
    const groups = groupMessages(messages, config.groupMinutes);
    const zone = filters.clock === 'local' ? countryTimezone(countryCodeOf(c)) : timezone;
    for (const group of groups) {
      const chart = bucketIndex(buckets, dayKey(group.at, timezone));
      if (group.direction === 'INBOUND') {
        if (auto(group.key)) continue;
        if (within(group.at, current)) {
          totals.inbound++; inboundCustomers.add(customerId);
          const row = ownerRow(owner); row.received++; row.customers.add(customerId);
          if (zone) { const [weekday, hour] = formatInTimeZone(group.at, zone, 'i H').split(' ').map(Number); heat[weekday - 1][hour]++; } else unknownZone++;
        } else if (within(group.at, previous)) totals.previousInbound++;
        if (chart >= 0) points[chart].inbound++;
        continue;
      }
      if (!ours(group)) continue;
      if (within(group.at, current)) {
        totals.outbound++; outboundCustomers.add(customerId); channelGroups[groupChannel(group)]++;
        const row = ownerRow(owner); row.sent++; row.customers.add(customerId);
      } else if (within(group.at, previous)) totals.previousOutbound++;
      if (chart >= 0) points[chart].outbound++;
    }
    for (const turn of responseTurns(groups, auto, loadEnd)) {
      if (within(turn.at, current)) { turns.push(turn); ownerRow(owner).turns.push(turn); }
      else if (within(turn.at, previous)) previousTurns.push(turn);
      const chart = bucketIndex(buckets, dayKey(turn.at, timezone));
      if (chart >= 0 && turn.minutes !== null && Number.isFinite(turn.minutes)) bucketTurns[chart].push(turn.minutes);
    }
  }
  bucketTurns.forEach((list, index) => { points[index].speed = median(list); });
  const speed = speedOf(turns), previousSpeed = speedOf(previousTurns);

  // Where each effective customer's chat stands now: waiting for us, waiting for them, or quiet for three days.
  const lastActivity = (c: (typeof effective)[number]) => Math.max(c.lastInboundAt!.getTime(), c.lastOutboundAt?.getTime() ?? 0);
  const waitingForUs = (c: (typeof effective)[number]) => !c.lastOutboundAt || c.lastInboundAt! > c.lastOutboundAt;
  const person = (c: (typeof effective)[number], since: number) => ({ id: c.id, name: c.name, grade: c.leadGrade, waitedMinutes: Math.max(0, Math.round((now.getTime() - since) / 60_000)) });
  const waiting = effective.filter(waitingForUs).sort((a, b) => a.lastInboundAt!.getTime() - b.lastInboundAt!.getTime());
  const quiet = effective.filter(c => !waitingForUs(c) && now.getTime() - lastActivity(c) > QUIET_MS).sort((a, b) => lastActivity(a) - lastActivity(b));
  const theirTurn = effective.filter(c => !waitingForUs(c) && now.getTime() - lastActivity(c) <= QUIET_MS).sort((a, b) => lastActivity(b) - lastActivity(a));
  const waitingBy = new Map<string, number>();
  for (const c of waiting) waitingBy.set(ownerKey(c), (waitingBy.get(ownerKey(c)) ?? 0) + 1);
  const effectiveBy = new Map<string, number>();
  for (const c of effective) effectiveBy.set(ownerKey(c), (effectiveBy.get(ownerKey(c)) ?? 0) + 1);
  const ownerIds = new Set([...owners.keys(), ...waitingBy.keys()]);

  return {
    selected: { range: selected.range, startKey: selected.startKey, endKey: selected.endKey, label: selected.label, trend: selected.trend },
    filters,
    options: {
      owners: people.filter(p => p.isActive).map(p => ({ id: p.id, name: p.name })),
      countries: countryRows.map(row => row.country),
    },
    groupMinutes: config.groupMinutes,
    clock: { mode: filters.clock, company: clockLabel, unknown: unknownZone },
    effectiveCustomers: effective.length,
    inbound: { groups: totals.inbound, customers: inboundCustomers.size, change: changeRate(totals.inbound, totals.previousInbound), previous: totals.previousInbound },
    outbound: { groups: totals.outbound, customers: outboundCustomers.size, change: changeRate(totals.outbound, totals.previousOutbound), previous: totals.previousOutbound,
      channels: (Object.keys(CHANNELS) as Channel[]).map(key => ({ key, label: CHANNELS[key], groups: channelGroups[key], share: rate(channelGroups[key], totals.outbound) })) },
    speed: { ...speed, previousMedian: previousSpeed.median },
    waiting: { total: waiting.length, late: waiting.filter(c => now.getTime() - c.lastInboundAt!.getTime() > LATE_MS).length,
      lateA: waiting.filter(c => c.leadGrade === 'A' && now.getTime() - c.lastInboundAt!.getTime() > LATE_MS).length,
      people: waiting.slice(0, LIST_LIMIT).map(c => person(c, c.lastInboundAt!.getTime())) },
    states: [
      { key: 'US', label: '等我们回复', count: waiting.length, people: waiting.slice(0, 3).map(c => person(c, c.lastInboundAt!.getTime())) },
      { key: 'THEM', label: '等客户回复', count: theirTurn.length, people: theirTurn.slice(0, 3).map(c => person(c, lastActivity(c))) },
      { key: 'QUIET', label: '3 天没动静', count: quiet.length, people: quiet.slice(0, 3).map(c => person(c, lastActivity(c))) },
    ],
    daily: { label: selected.range === 'today' ? '近 7 天（含今日）' : `${selected.startKey} — ${selected.endKey}`, view: selected.trend, points },
    heatmap: { cells: heat, busiest: busiestHours(heat), weekend: weekendDifference(heat) },
    owners: [...ownerIds].map(id => {
      const row = owners.get(id) ?? { sent: 0, received: 0, customers: new Set<string>(), turns: [] };
      const ownerSpeed = speedOf(row.turns);
      return { id, name: id === 'pool' ? '待分配' : nameOf.get(id) ?? '—', sent: row.sent, received: row.received, customers: effectiveBy.get(id) ?? row.customers.size,
        median: ownerSpeed.median, within5: ownerSpeed.within5, waiting: waitingBy.get(id) ?? 0 };
    }).sort((a, b) => Number(a.id === 'pool') - Number(b.id === 'pool') || b.sent + b.received - a.sent - a.received),
  };
}
export type MessageAnalytics = Awaited<ReturnType<typeof messageAnalytics>>;
