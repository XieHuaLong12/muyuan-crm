import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { bucketIndex, changeRate, cockpitSelection, periodPair, rate, trendBuckets } from '@/lib/business-cockpit';
import { countryTimezone } from '@/lib/country-timezone';
import { countryCodeOf } from '@/lib/phone-country';
import { CHANNELS, OUTREACH_STATES, QUALITIES, groupChannel, groupMessages, readConfig, type Channel, type FlowMessage, type MessageGroup } from '@/lib/outreach';
import { dayKey, localDate } from '@/lib/time';
import { SPEED_BUCKETS, busiestHours, gradeKey, median, pointsBetween, responseTurns, speedBucket, weekendDifference } from '@/lib/analytics';
import { queueFilters } from './bos-sales-service';

/** Filters on top of the period. A wrong value in a hand-edited link falls back to 全部 instead of failing the page. */
const filterSchema = z.object({
  owner: z.string().trim().max(191).catch(''),
  grade: z.enum(['', 'A', 'B', 'C', 'D', 'none']).catch(''),
  country: z.string().trim().max(100).catch(''),
  channel: z.enum(['', 'BOS_TEMPLATE', 'BOS_FREE', 'PHONE']).catch(''),
  clock: z.enum(['company', 'local']).catch('company'),
});
export type MessageAnalyticsFilters = z.infer<typeof filterSchema>;
type Query = Parameters<typeof cockpitSelection>[0] & Partial<Record<keyof MessageAnalyticsFilters, string>>;

const HOUR = 3600_000, DAY = 24 * HOUR;
/** Messages this long before the period are read too: an answer needs the question, a template its 24-hour window. */
const LOOKBACK = 7 * DAY;
/** Customers waiting longer than this for us count as 待我们回复. */
const WAITING_MS = 2 * HOUR;
const REPLY_QUALITIES = ['HIGH', 'ENGAGED', 'LOW', 'REJECT'] as const;
const SHOWN_GRADES = ['A', 'B', 'C'] as const;

type Turn = { at: Date; minutes: number | null };
const speedOf = (turns: Turn[]) => {
  const decided = turns.filter(turn => turn.minutes !== null).map(turn => turn.minutes!);
  const middle = median(decided);
  return {
    median: middle, decided: decided.length, pending: turns.length - decided.length,
    within5: rate(decided.filter(minutes => minutes <= 5).length, decided.length),
    within60: rate(decided.filter(minutes => minutes <= 60).length, decided.length),
    buckets: SPEED_BUCKETS.map((bucket, index) => {
      const count = decided.filter(minutes => speedBucket(minutes) === index).length;
      return { label: bucket.label, count, share: rate(count, decided.length) };
    }),
  };
};

/**
 * 消息分析: WhatsApp messages by the time they were sent, counted in groups (messages one side sends within the
 * outreach setting's minutes of each other are one group, as for scripts). Who wrote how much, how fast we answer,
 * whether customers answer us, when they write, how good their replies are (the reply judgements of 话术效果) and how
 * the conversations stand now. Customer filters (owner, grade, country) choose the conversations; the 发送方式 filter
 * only narrows the messages we sent. Read only.
 */
export async function messageAnalytics(user: Actor, query: Query = {}, now = new Date()) {
  const filters = filterSchema.parse(query);
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, outreachConfig: true, outreachStartedAt: true } });
  const { timezone } = setting, config = readConfig(setting.outreachConfig);
  const selected = cockpitSelection(query, timezone, now);
  const { current, previous } = periodPair(selected, now);
  const buckets = trendBuckets(selected);
  const chartStart = localDate(`${selected.trendStartKey}T00:00`, timezone);
  const loadStart = new Date(Math.min(previous.start.getTime(), chartStart.getTime()) - LOOKBACK);
  // A day past the period, so a question asked on its last evening still finds our answer.
  const loadEnd = new Date(Math.min(now.getTime(), current.end.getTime() + DAY + HOUR));
  const customerWhere: Prisma.CustomerWhereInput = { AND: [scope(user),
    ...(filters.owner ? [{ ownerId: filters.owner }] : []),
    ...(filters.grade ? [{ leadGrade: filters.grade === 'none' ? '' : filters.grade }] : []),
    ...(filters.country ? [{ country: filters.country }] : [])] };

  const rows = await db.whatsAppMessage.findMany({
    where: { customer: customerWhere, direction: { in: ['INBOUND', 'OUTBOUND'] }, status: { notIn: ['FAILED', 'PENDING'] }, sentAt: { gte: loadStart, lt: loadEnd } },
    select: { id: true, customerId: true, direction: true, sentAt: true, messageType: true, requestId: true, sentById: true },
    orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
  });
  const ids = [...new Set(rows.map(row => row.customerId))];
  const waitingSince = new Date(now.getTime() - WAITING_MS);
  const [customers, replies, icebreaks, waiting, people, countryRows] = await Promise.all([
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true, pendingAssignment: true, leadGrade: true, country: true, countryCode: true,
      whatsapp: true, waId: true, phone: true, outreachState: true, lastInboundAt: true } }),
    db.outreachReply.findMany({ where: { customerId: { in: ids }, receivedAt: { gte: loadStart, lt: loadEnd } }, select: { groupKey: true, quality: true } }),
    db.outreachTouch.findMany({ where: { kind: 'ICEBREAK', repliedAt: { gte: current.start, lt: current.end }, replyQuality: { not: 'INVALID' }, customer: customerWhere }, select: { customerId: true } }),
    db.customer.findMany({ where: { AND: [customerWhere, queueFilters(now).waiting, { lastInboundAt: { lt: waitingSince } }] }, select: { ownerId: true, pendingAssignment: true, leadGrade: true, lastInboundAt: true } }),
    db.user.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
    db.customer.groupBy({ by: ['country'], where: { AND: [scope(user), { country: { not: '' } }] }, orderBy: { country: 'asc' } }),
  ]);
  const customerOf = new Map(customers.map(c => [c.id, c]));
  const quality = new Map(replies.map(reply => [reply.groupKey, reply.quality]));
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
  // Answers to our messages count up to a day after the period, as the messages read for it.
  const answeredBy = (period: { end: Date }) => new Date(period.end.getTime() + DAY + HOUR);
  const ours = (group: MessageGroup) => !filters.channel || groupChannel(group) === filters.channel;
  const clockLabel = timezone === 'Asia/Shanghai' ? '北京时间' : `${timezone} 时间`;

  const totals = { inbound: 0, previousInbound: 0, outbound: 0, previousOutbound: 0 };
  const inboundCustomers = new Set<string>(), outboundCustomers = new Set<string>(), talked = new Set<string>();
  const channelGroups: Record<Channel, number> = { BOS_TEMPLATE: 0, BOS_FREE: 0, PHONE: 0 };
  const points = buckets.map(bucket => ({ label: bucket.label, start: bucket.start, end: bucket.end, inbound: 0, outbound: 0 }));
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let unknownZone = 0;
  const turns: (Turn & { grade: string; owner: string })[] = [], previousTurns: Turn[] = [];
  const reached = { now: new Map<string, boolean>(), before: new Map<string, boolean>() };
  const qualityRows = new Map<string, Record<string, number>>(), autoReplies = { count: 0 };
  const templates = { sent: 0, outsideWindow: 0, replied: 0, customers: new Set<string>() };
  const owners = new Map<string, { sent: number; received: number; customers: Set<string>; turns: Turn[]; messaged: Set<string>; replied: Set<string> }>();
  const ownerRow = (key: string) => {
    if (!owners.has(key)) owners.set(key, { sent: 0, received: 0, customers: new Set(), turns: [], messaged: new Set(), replied: new Set() });
    return owners.get(key)!;
  };

  for (const [customerId, messages] of messagesOf) {
    const c = customerOf.get(customerId);
    if (!c) continue;
    const owner = ownerKey(c), grade = gradeKey(c.leadGrade);
    const groups = groupMessages(messages, config.groupMinutes);
    const zone = filters.clock === 'local' ? countryTimezone(countryCodeOf(c)) : timezone;
    let lastInbound: Date | null = null, ourEarlier = false;
    let firstOursNow: Date | null = null, firstOursBefore: Date | null = null;
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index], inbound = group.direction === 'INBOUND', last = group.messages[group.messages.length - 1].sentAt;
      const chart = bucketIndex(buckets, dayKey(group.at, timezone));
      if (inbound) {
        lastInbound = last;
        // An auto reply opens the 24-hour window but is not the customer writing: it is counted apart and nowhere else.
        if (auto(group.key)) { if (ourEarlier && within(group.at, current)) autoReplies.count++; continue; }
        if (within(group.at, current)) {
          totals.inbound++; inboundCustomers.add(customerId); talked.add(customerId);
          const row = ownerRow(owner); row.received++; row.customers.add(customerId);
          if (zone) { const [weekday, hour] = formatInTimeZone(group.at, zone, 'i H').split(' ').map(Number); heat[weekday - 1][hour]++; } else unknownZone++;
          // Reply quality: only the customer's answers to us, as judged for 话术效果.
          const judged = quality.get(group.key);
          if (ourEarlier && judged && (REPLY_QUALITIES as readonly string[]).includes(judged) && (SHOWN_GRADES as readonly string[]).includes(grade)) {
            const counts = qualityRows.get(grade) ?? { HIGH: 0, ENGAGED: 0, LOW: 0, REJECT: 0 };
            counts[judged]++; qualityRows.set(grade, counts);
          }
        } else if (within(group.at, previous)) totals.previousInbound++;
        if (chart >= 0) points[chart].inbound++;
        if (firstOursNow && group.at > firstOursNow) reached.now.set(customerId, true);
        if (firstOursBefore && group.at > firstOursBefore && group.at < answeredBy(previous)) reached.before.set(customerId, true);
        continue;
      }
      ourEarlier = true;
      const counted = ours(group);
      if (within(group.at, current)) {
        talked.add(customerId);
        ownerRow(owner).customers.add(customerId);
        if (counted) {
          totals.outbound++; outboundCustomers.add(customerId);
          const channel = groupChannel(group); channelGroups[channel]++;
          const row = ownerRow(owner); row.sent++; row.messaged.add(customerId);
          if (!firstOursNow) { firstOursNow = group.at; reached.now.set(customerId, false); }
          if (channel === 'BOS_TEMPLATE') {
            templates.sent++; templates.customers.add(customerId);
            if (!lastInbound || group.at.getTime() - lastInbound.getTime() > DAY) templates.outsideWindow++;
            const answer = groups.slice(index + 1).find(next => next.direction === 'INBOUND' && !auto(next.key));
            if (answer && answer.at.getTime() - group.at.getTime() <= DAY) templates.replied++;
          }
        }
      } else if (within(group.at, previous) && counted) {
        totals.previousOutbound++;
        if (!firstOursBefore) { firstOursBefore = group.at; reached.before.set(customerId, false); }
      }
      if (chart >= 0 && counted) points[chart].outbound++;
    }
    for (const turn of responseTurns(groups, auto, loadEnd)) {
      if (within(turn.at, current)) { turns.push({ ...turn, grade, owner }); ownerRow(owner).turns.push(turn); }
      else if (within(turn.at, previous)) previousTurns.push(turn);
    }
    if (reached.now.get(customerId)) ownerRow(owner).replied.add(customerId);
  }

  // Customers we wrote to in the period, and how many wrote back after our first message.
  const repliedNow = [...reached.now.values()].filter(Boolean).length, repliedBefore = [...reached.before.values()].filter(Boolean).length;
  const replyRate = rate(repliedNow, reached.now.size), previousReplyRate = rate(repliedBefore, reached.before.size);
  const speed = speedOf(turns), previousSpeed = speedOf(previousTurns);

  // Templates: customers who have had the most we may send without an answer, counted over their whole history.
  const capped = templates.customers.size ? await db.whatsAppMessage.findMany({
    where: { customerId: { in: [...templates.customers] }, direction: 'OUTBOUND', messageType: 'TEMPLATE', requestId: { not: null }, status: { notIn: ['FAILED', 'PENDING'] } },
    select: { customerId: true, sentAt: true } }) : [];
  const sinceReply = new Map<string, number>();
  for (const message of capped) {
    const lastInbound = customerOf.get(message.customerId)?.lastInboundAt;
    if (!lastInbound || message.sentAt > lastInbound) sinceReply.set(message.customerId, (sinceReply.get(message.customerId) ?? 0) + 1);
  }

  const stateCounts = new Map<string, number>();
  for (const id of talked) { const state = customerOf.get(id)?.outreachState || ''; if (state) stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1); }
  const waitingBy = new Map<string, number>();
  for (const c of waiting) waitingBy.set(ownerKey(c), (waitingBy.get(ownerKey(c)) ?? 0) + 1);
  const ownerIds = new Set([...owners.keys(), ...waitingBy.keys()]);

  return {
    selected: { range: selected.range, startKey: selected.startKey, endKey: selected.endKey, label: selected.label, trend: selected.trend },
    filters,
    options: {
      owners: people.filter(person => person.isActive).map(person => ({ id: person.id, name: person.name })),
      countries: countryRows.map(row => row.country),
    },
    groupMinutes: config.groupMinutes,
    clock: { mode: filters.clock, company: clockLabel, unknown: unknownZone },
    inbound: { groups: totals.inbound, customers: inboundCustomers.size, change: changeRate(totals.inbound, totals.previousInbound) },
    outbound: { groups: totals.outbound, customers: outboundCustomers.size, change: changeRate(totals.outbound, totals.previousOutbound),
      channels: (Object.keys(CHANNELS) as Channel[]).map(key => ({ key, label: CHANNELS[key], groups: channelGroups[key], share: rate(channelGroups[key], totals.outbound) })) },
    replyRate: { customers: reached.now.size, replied: repliedNow, rate: replyRate, previousRate: previousReplyRate, points: pointsBetween(replyRate, previousReplyRate),
      byGrade: SHOWN_GRADES.map(grade => {
        const messaged = [...reached.now].filter(([id]) => customerOf.get(id)?.leadGrade === grade);
        return { grade, customers: messaged.length, rate: rate(messaged.filter(([, replied]) => replied).length, messaged.length) };
      }) },
    speed: { ...speed, previousMedian: previousSpeed.median,
      byGrade: SHOWN_GRADES.map(grade => ({ grade, median: median(turns.filter(turn => turn.grade === grade && turn.minutes !== null).map(turn => turn.minutes!)) })) },
    waiting: { total: waiting.length, good: waiting.filter(c => c.leadGrade === 'A' || c.leadGrade === 'B').length,
      overDay: waiting.filter(c => c.lastInboundAt && now.getTime() - c.lastInboundAt.getTime() > DAY).length },
    daily: { label: selected.range === 'today' ? '近 7 天（含今日）' : `${selected.startKey} — ${selected.endKey}`, view: selected.trend, points },
    heatmap: { cells: heat, busiest: busiestHours(heat), weekend: weekendDifference(heat) },
    quality: {
      rows: SHOWN_GRADES.map(grade => {
        const counts = qualityRows.get(grade) ?? { HIGH: 0, ENGAGED: 0, LOW: 0, REJECT: 0 };
        const total = REPLY_QUALITIES.reduce((sum, key) => sum + counts[key], 0);
        return { grade, total, parts: REPLY_QUALITIES.map(key => ({ key, label: QUALITIES[key], count: counts[key], share: rate(counts[key], total) })) };
      }),
      auto: autoReplies.count,
      since: setting.outreachStartedAt ? dayKey(setting.outreachStartedAt, timezone) : null,
    },
    states: (Object.keys(OUTREACH_STATES) as (keyof typeof OUTREACH_STATES)[]).map(key => ({ key, label: OUTREACH_STATES[key], count: stateCounts.get(key) ?? 0 })),
    talked: talked.size,
    icebreakWins: new Set(icebreaks.map(touch => touch.customerId)).size,
    owners: [...ownerIds].map(id => {
      const row = owners.get(id) ?? { sent: 0, received: 0, customers: new Set<string>(), turns: [], messaged: new Set<string>(), replied: new Set<string>() };
      const ownerSpeed = speedOf(row.turns);
      return { id, name: id === 'pool' ? '待分配' : nameOf.get(id) ?? '—', sent: row.sent, received: row.received, customers: row.customers.size,
        median: ownerSpeed.median, within5: ownerSpeed.within5, replyRate: rate(row.replied.size, row.messaged.size), waiting: waitingBy.get(id) ?? 0 };
    }).sort((a, b) => Number(a.id === 'pool') - Number(b.id === 'pool') || b.sent + b.received - a.sent - a.received),
    templates: { sent: templates.sent, outsideWindow: templates.outsideWindow, replyRate: rate(templates.replied, templates.sent),
      capped: [...sinceReply.values()].filter(count => count >= config.templateCap).length, cap: config.templateCap },
  };
}
export type MessageAnalytics = Awaited<ReturnType<typeof messageAnalytics>>;
