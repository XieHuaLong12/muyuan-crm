import { fromZonedTime } from 'date-fns-tz';
import type { CountryConfig, RadarConfig } from './radar';

/**
 * When a cold e-mail may go out (docs/CUSTOMER_RADAR_COLD_EMAIL.md §7.1): the recipient's working days and hours,
 * the mailbox's daily cap from its warm-up, a random gap between two mails of one mailbox, and the queue order.
 * Pure functions: the sender uses them to pick the next mail, the planner to estimate when the queue is done.
 */

export const MINUTE = 60_000;
export const DAY_MS = 24 * 60 * MINUTE;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  return f;
}
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local calendar day, weekday (0 = Sunday) and minutes since local midnight of an instant in a time zone. */
export function localParts(at: Date, tz: string) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(at).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAY[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const workday = (day: string, c: CountryConfig) => c.workdays.includes(weekdayOf(day)) && !c.holidays.includes(day);

/** Whether a mail may reach this recipient now: a working day, not a holiday, inside the sending hours. */
export function inWindow(at: Date, c: CountryConfig, tz: string) {
  const p = localParts(at, tz);
  return c.workdays.includes(p.weekday) && !c.holidays.includes(p.day) && p.minutes >= toMinutes(c.start) && p.minutes < toMinutes(c.end);
}

/** The first instant at or after `after` inside the recipient's sending hours (searching up to 60 days ahead). */
export function nextWindowStart(after: Date, c: CountryConfig, tz: string): Date | null {
  if (inWindow(after, c, tz)) return after;
  const p = localParts(after, tz);
  let day = p.day;
  if (!(workday(day, c) && p.minutes < toMinutes(c.start))) day = nextDay(day);
  for (let i = 0; i < 60; i++, day = nextDay(day)) if (workday(day, c)) return fromZonedTime(`${day}T${c.start}:00`, tz);
  return null;
}

/** The start of the sending hours `n` working days after the local day of `from` (the follow-up due time). */
export function addWorkdays(from: Date, n: number, c: CountryConfig, tz: string) {
  let day = localParts(from, tz).day;
  for (let left = n, guard = 0; left > 0 && guard < 400; guard++) { day = nextDay(day); if (workday(day, c)) left--; }
  return fromZonedTime(`${day}T${c.start}:00`, tz);
}

/** Week of the warm-up an instant falls in: 0 for the first seven days. */
export const warmupWeek = (start: Date, at: Date) => Math.max(0, Math.floor((at.getTime() - start.getTime()) / (7 * DAY_MS)));
/** A mailbox's daily cap from its warm-up level, never above a cap set by hand. Before the warm-up starts: 0. */
export function dailyCap(mailbox: { capLevel: number; capOverride: number | null; warmupStartedAt: Date }, levels: number[], at: Date) {
  if (at < mailbox.warmupStartedAt) return 0;
  const auto = levels[Math.min(mailbox.capLevel, levels.length - 1)] ?? 0;
  return mailbox.capOverride === null ? auto : Math.min(auto, mailbox.capOverride);
}
/**
 * The warm-up moves up one level a week while the week behind it was clean (bounces under the line, no complaint);
 * otherwise it holds, so a bad week is never followed by more mail.
 */
export function nextCapLevel(mailbox: { capLevel: number; rampedAt: Date | null; warmupStartedAt: Date }, levels: number[], at: Date, cleanWeek: boolean) {
  const target = Math.min(warmupWeek(mailbox.warmupStartedAt, at), levels.length - 1);
  const since = mailbox.rampedAt ?? mailbox.warmupStartedAt;
  if (mailbox.capLevel >= target || at.getTime() - since.getTime() < 7 * DAY_MS || !cleanWeek) return mailbox.capLevel;
  return mailbox.capLevel + 1;
}

/** The gap before a mailbox's next mail: a whole number of minutes, uniformly between the configured bounds. */
export const randomGap = (config: Pick<RadarConfig, 'intervalMin' | 'intervalMax'>, random = Math.random) =>
  (config.intervalMin + Math.floor(random() * (config.intervalMax - config.intervalMin + 1))) * MINUTE;

// ─── Queue order and planning ───────────────────────────

export type QueueItem = {
  id: string; step: number; dueAt: Date; pinnedAt: Date | null; grade: string; score: number; createdAt: Date;
  risky: boolean; timezone: string; country: CountryConfig;
  /** Follow-ups must leave from the mailbox of their thread. */
  mailboxId: string | null;
};
const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };
/** 插队 first, then follow-ups (oldest due first), then new mails A → B → C, higher score first, earlier added first. */
export function compareQueue(a: QueueItem, b: QueueItem) {
  if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
  if (a.pinnedAt && b.pinnedAt && a.pinnedAt.getTime() !== b.pinnedAt.getTime()) return a.pinnedAt.getTime() - b.pinnedAt.getTime();
  const followA = a.step > 1, followB = b.step > 1;
  if (followA !== followB) return followA ? -1 : 1;
  if (followA && a.dueAt.getTime() !== b.dueAt.getTime()) return a.dueAt.getTime() - b.dueAt.getTime();
  const grade = (GRADE_ORDER[a.grade] ?? 3) - (GRADE_ORDER[b.grade] ?? 3);
  if (grade) return grade;
  if (a.score !== b.score) return b.score - a.score;
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

export type MailboxState = { id: string; cap: number; sentToday: number; riskyToday: number; nextSendAt: Date | null };
/** Whether a mail may leave from this mailbox at this instant (its window, due time, thread mailbox, risky cap). */
export function eligible(item: QueueItem, mailbox: Pick<MailboxState, 'id' | 'riskyToday'>, at: Date, riskyCap: number) {
  return item.dueAt <= at && (!item.mailboxId || item.mailboxId === mailbox.id) && (!item.risky || mailbox.riskyToday < riskyCap) && inWindow(at, item.country, item.timezone);
}
/** The mail a mailbox should send now: the first eligible one in queue order. */
export function pickNext<T extends QueueItem>(items: T[], mailbox: Pick<MailboxState, 'id' | 'riskyToday'>, at: Date, riskyCap: number): T | null {
  return [...items].sort(compareQueue).find(item => eligible(item, mailbox, at, riskyCap)) ?? null;
}

/**
 * Simulates the queue with the same rules the sender follows — each mailbox sends its next eligible mail as soon as
 * its gap has passed, within its daily cap (counted per day in `dayTz`, the company's time zone) — using the average
 * gap. Returns each mail's planned time and mailbox; mails that do not fit in `horizonDays` stay unplanned.
 */
export function planQueue(input: {
  now: Date; items: QueueItem[]; mailboxes: MailboxState[]; config: Pick<RadarConfig, 'intervalMin' | 'intervalMax' | 'riskyPerMailboxPerDay'>;
  dayTz: string; horizonDays?: number;
}) {
  const gap = (input.config.intervalMin + input.config.intervalMax) / 2 * MINUTE;
  const horizon = input.now.getTime() + (input.horizonDays ?? 14) * DAY_MS;
  const pending = [...input.items].sort(compareQueue);
  const plan = new Map<string, { at: Date; mailboxId: string }>();
  const today = localParts(input.now, input.dayTz).day;
  const boxes = input.mailboxes.filter(m => m.cap > 0).map(m => ({
    ...m, clock: Math.max(input.now.getTime(), m.nextSendAt?.getTime() ?? 0), day: today, used: m.sentToday, risky: m.riskyToday,
  }));
  const dayStart = (day: string) => fromZonedTime(`${day}T00:00:00`, input.dayTz).getTime();
  let guard = 0;
  while (pending.length && boxes.length && guard++ < 50_000) {
    const box = boxes.reduce((a, b) => (b.clock < a.clock ? b : a));
    if (box.clock > horizon) break;
    const at = new Date(box.clock);
    const day = localParts(at, input.dayTz).day;
    if (day !== box.day) { box.day = day; box.used = 0; box.risky = 0; }
    if (box.used >= box.cap) { box.clock = dayStart(nextDay(box.day)); continue; }
    const index = pending.findIndex(item => eligible(item, { id: box.id, riskyToday: box.risky }, at, input.config.riskyPerMailboxPerDay));
    if (index >= 0) {
      const [item] = pending.splice(index, 1);
      plan.set(item.id, { at, mailboxId: box.id });
      box.used++; if (item.risky) box.risky++;
      box.clock += gap;
      continue;
    }
    // Nothing can go now: jump to the next moment one of the remaining mails could.
    let next = Infinity;
    const tomorrow = dayStart(nextDay(box.day));
    for (const item of pending) {
      if (item.mailboxId && item.mailboxId !== box.id) continue;
      // A risky address over today's risky cap waits for the mailbox's next day.
      const earliest = item.risky && box.risky >= input.config.riskyPerMailboxPerDay ? tomorrow : box.clock + MINUTE;
      const from = new Date(Math.max(earliest, item.dueAt.getTime()));
      const start = nextWindowStart(from, item.country, item.timezone);
      if (start) next = Math.min(next, start.getTime());
    }
    if (next === Infinity) boxes.splice(boxes.indexOf(box), 1);
    else box.clock = Math.max(next, box.clock + MINUTE);
  }
  return plan;
}
