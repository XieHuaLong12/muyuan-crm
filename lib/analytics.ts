import { ADVANCED_STAGES } from './constants';
import { isQualified } from './metrics';

/**
 * Pure rules behind 客户分析 and 消息分析 (docs/METRICS.md §客户分析 / §消息分析). The services load the records; what
 * counts as a funnel step, a customer's current place, a reply or a response time is decided here, once.
 */

/** Form grades as the analysis groups them; '' is 未评级. */
export const GRADE_KEYS = ['A', 'B', 'C', 'D', ''] as const;
export type GradeKey = (typeof GRADE_KEYS)[number];
export const gradeKey = (grade: string): GradeKey => (GRADE_KEYS as readonly string[]).includes(grade) ? grade as GradeKey : '';
export const gradeLabel = (grade: string) => grade || '未评级';
/** A and B are the leads worth the most attention (优质线索). */
export const isGoodGrade = (grade: string) => grade === 'A' || grade === 'B';

export const FUNNEL_STEPS = ['线索', '已联系', '已回复 · 有效', '需求确认', '已报价', '成交'] as const;
const NEEDS_STAGES = ['NEEDS_CONFIRMED', 'PRODUCT_CONFIRMED'];

export type FunnelFacts = {
  stage: string; isQualified: boolean | null; contactedAt: Date | null; firstContactAt: Date | null; lastOutboundAt: Date | null;
  lastFollowUpAt: Date | null; needsConfirmedAt: Date | null; quotedAt: Date | null; quotations: unknown[]; deals: unknown[];
};
/** We reached out: a message, a logged follow-up or a recorded first contact. */
export const wasContacted = (c: Pick<FunnelFacts, 'contactedAt' | 'firstContactAt' | 'lastOutboundAt' | 'lastFollowUpAt'>) =>
  !!(c.contactedAt || c.firstContactAt || c.lastOutboundAt || c.lastFollowUpAt);

/**
 * The furthest funnel step a customer has reached, whatever happened after (a lost customer who was quoted counts as
 * quoted): 0 线索, 1 已联系, 2 已回复 · 有效, 3 需求确认, 4 已报价, 5 成交. Steps from 有效 on need the shared 有效 rule
 * (lib/metrics isQualified), so this funnel's 有效 is the same number as 有效客户 on every page.
 */
export function funnelDepth(c: FunnelFacts) {
  if (!isQualified(c)) return wasContacted(c) ? 1 : 0;
  if (c.deals.length || c.stage === 'WON') return 5;
  if (c.quotedAt || c.quotations.length || (ADVANCED_STAGES as readonly string[]).includes(c.stage)) return 4;
  if (c.needsConfirmedAt || NEEDS_STAGES.includes(c.stage)) return 3;
  return 2;
}

/** Customers per funnel step: everyone who got at least that far. */
export function funnelCounts(depths: number[]) {
  return FUNNEL_STEPS.map((_, step) => depths.filter(depth => depth >= step).length);
}

/** The step (1–5) where the fewest go on from the step before; -1 when no step has anyone to lose. */
export function weakestStep(counts: number[], minimum = 1) {
  let weakest = -1, lowest = Infinity;
  for (let step = 1; step < counts.length; step++) {
    if (counts[step - 1] < minimum) continue;
    const kept = counts[step] / counts[step - 1];
    if (kept < lowest) { lowest = kept; weakest = step; }
  }
  return weakest;
}

/** Where a customer is now. Every customer is in exactly one place; the first matching rule wins. */
export const STATUSES = {
  ICEBREAK: '破冰中 · 等客户回复', CONVERSING: '对话中', SILENT: '沉默期', DORMANT: '沉睡', QUOTED: '已报价 · 跟进中',
  FIRST_CONTACT: '待首联', POOL: '待分配', WON: '已成交', LOST: '已流失 / 暂不需要', INVALID: '无效', STOPPED: '停止联系',
} as const;
export type Status = keyof typeof STATUSES;
const OUTREACH_PLACES = ['CONVERSING', 'SILENT', 'DORMANT', 'STOPPED'] as const;

export function customerStatus(c: FunnelFacts & { pendingAssignment: boolean; outreachState: string }): Status {
  if (c.deals.length || c.stage === 'WON') return 'WON';
  if (c.stage === 'INVALID') return 'INVALID';
  if (c.stage === 'LOST' || c.stage === 'PAUSED') return 'LOST';
  if (c.pendingAssignment) return 'POOL';
  if (['QUOTED', 'FOLLOW_UP', 'ORDER'].includes(c.stage)) return 'QUOTED';
  if (!wasContacted(c)) return 'FIRST_CONTACT';
  if ((OUTREACH_PLACES as readonly string[]).includes(c.outreachState)) return c.outreachState as Status;
  return isQualified(c) ? 'CONVERSING' : 'ICEBREAK';
}

/**
 * First contact on time: the first message or call came before the deadline set at assignment. A lead not yet
 * contacted is late once the deadline has passed, and not counted before that. Same rule as the daily brief.
 */
export function firstContact(c: { firstContactDueAt: Date | null; firstContactAt: Date | null; contactedAt: Date | null; assignedAt: Date | null }, now: Date) {
  if (!c.firstContactDueAt) return null;
  const contacted = c.firstContactAt ?? c.contactedAt;
  const minutes = contacted && c.assignedAt ? Math.max(0, Math.round((contacted.getTime() - c.assignedAt.getTime()) / 60_000)) : null;
  if (contacted) return { onTime: contacted <= c.firstContactDueAt, overdue: false, minutes };
  return c.firstContactDueAt < now ? { onTime: false, overdue: true, minutes } : null;
}

/** The middle value (the lower one of the middle two); null for none. Infinity stands for "never". */
export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Percentage points between two rates, one decimal; null without both. */
export const pointsBetween = (current: number | null, previous: number | null) =>
  current === null || previous === null ? null : Math.round((current - previous) * 10) / 10;

/** How long we took to answer, in the buckets the speed chart shows. */
export const SPEED_BUCKETS = [
  { label: '5 分钟内', upTo: 5 }, { label: '5–30 分钟', upTo: 30 }, { label: '30 分钟–1 小时', upTo: 60 },
  { label: '1–4 小时', upTo: 240 }, { label: '4–24 小时', upTo: 1440 }, { label: '超过 24 小时或没回', upTo: Infinity },
] as const;
export const speedBucket = (minutes: number) => SPEED_BUCKETS.findIndex(bucket => minutes <= bucket.upTo);

/**
 * A grade a person set records the grade it replaced (outreach-review-service decideGrade writes 「（原 X）」 into the
 * reason). Returns that change, or null when the person kept the grade or the reason says nothing.
 */
export function gradeChange(reason: string, grade: string) {
  const from = /（原 ([ABCD]|未评级)）/.exec(reason)?.[1];
  if (!from) return null;
  const before = from === '未评级' ? '' : from;
  return before === grade ? null : { from: gradeLabel(before), to: gradeLabel(grade) };
}

const DAY_MS = 86400_000;
type TimedGroup = { key: string; direction: 'INBOUND' | 'OUTBOUND'; at: Date };

/**
 * Our response times. A customer's turn starts with their first message after ours (an auto reply does not start
 * one) and ends with our next message, so three questions in a row are one wait. Minutes to answer; Infinity when a
 * day went by without an answer; null while an unanswered turn is younger than a day (`until` is the last moment
 * the messages cover).
 */
export function responseTurns(groups: TimedGroup[], auto: (key: string) => boolean, until: Date) {
  const turns: { at: Date; minutes: number | null }[] = [];
  let open: Date | null = null;
  for (const group of groups) {
    if (group.direction === 'INBOUND') { if (!open && !auto(group.key)) open = group.at; continue; }
    if (open) turns.push({ at: open, minutes: Math.max(0, Math.round((group.at.getTime() - open.getTime()) / 60_000)) });
    open = null;
  }
  if (open) turns.push({ at: open, minutes: until.getTime() - open.getTime() > DAY_MS ? Infinity : null });
  return turns;
}

/** The busiest three hours of the week grid (hours summed over the days), as 「15–18 点」; null when too quiet to say. */
export function busiestHours(cells: number[][], minimum = 20) {
  const hours = Array.from({ length: 24 }, (_, hour) => cells.reduce((sum, day) => sum + day[hour], 0));
  if (hours.reduce((sum, value) => sum + value, 0) < minimum) return null;
  let best = 0, bestSum = -1;
  for (let hour = 0; hour < 24; hour++) {
    const sum = hours[hour] + hours[(hour + 1) % 24] + hours[(hour + 2) % 24];
    if (sum > bestSum) { bestSum = sum; best = hour; }
  }
  return `${best}–${(best + 3) % 24 || 24} 点`;
}

/** How much busier (positive) or quieter (negative) a weekend day is than a weekday, in percent; rows are Monday first. */
export function weekendDifference(cells: number[][], minimum = 20) {
  const totals = cells.map(day => day.reduce((sum, value) => sum + value, 0));
  if (totals.reduce((sum, value) => sum + value, 0) < minimum) return null;
  const weekday = totals.slice(0, 5).reduce((sum, value) => sum + value, 0) / 5, weekend = (totals[5] + totals[6]) / 2;
  return weekday > 0 ? Math.round((weekend - weekday) / weekday * 100) : null;
}
