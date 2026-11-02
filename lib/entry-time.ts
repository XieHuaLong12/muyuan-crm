import { formatInTimeZone } from 'date-fns-tz';
import { countryTimezone } from './country-timezone';

/**
 * 进线时间 (docs/METRICS.md §进线时间): when a lead first entered the system — the Meta form submission time, the
 * customer's first WhatsApp message, or for a lead entered by hand the moment it was entered (a date picked in the
 * form has no clock time). It is Customer.inquiryAt; customers without one fall back to createdAt and are 估算.
 * Everything here is pure so the list, the profile, the country card and the plan agree.
 */

export const DEFAULT_WORK_HOURS = { start: 8, end: 22 } as const;
export type WorkHours = { start: number; end: number };
export const workHoursOf = (s: { workStartHour?: number | null; workEndHour?: number | null }): WorkHours => {
  const start = s.workStartHour ?? DEFAULT_WORK_HOURS.start, end = s.workEndHour ?? DEFAULT_WORK_HOURS.end;
  return start >= 0 && end <= 24 && start < end ? { start, end } : { ...DEFAULT_WORK_HOURS };
};
export const workHoursText = (w: WorkHours) => `${w.start}:00–${w.end}:00`;

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/** Weekday (0 = Monday) and hour of an instant in a time zone. */
export function clockIn(at: Date, zone: string) {
  const [isoDay, hour, minute] = formatInTimeZone(at, zone, 'i H m').split(' ').map(Number);
  return { weekday: isoDay - 1, hour, minute };
}

/** Inside the working day [start, end) in the company's time zone. */
export function inWorkHours(at: Date, zone: string, hours: WorkHours) {
  const { hour } = clockIn(at, zone);
  return hour >= hours.start && hour < hours.end;
}

export type EntryFacts = { inquiryAt: Date | null; createdAt: Date };
/**
 * The entry instant and how much it can be trusted. `exact` has a real clock time (a date picked by hand or imported
 * without a time is stored as midnight in the company zone, so hour-of-day analysis leaves it out); `estimated`
 * means there was no inquiry time at all and the record's creation time stands in.
 */
export function entryOf(c: EntryFacts, zone: string) {
  if (!c.inquiryAt) return { at: c.createdAt, exact: false, estimated: true };
  const midnight = formatInTimeZone(c.inquiryAt, zone, 'HH:mm:ss.SSS') === '00:00:00.000';
  return { at: c.inquiryAt, exact: !midnight, estimated: false };
}

/** Outside the working hours: only meaningful for an exact entry time. */
export const enteredOffHours = (c: EntryFacts, zone: string, hours: WorkHours) => {
  const entry = entryOf(c, zone);
  return entry.exact && !inWorkHours(entry.at, zone, hours);
};

/** The customer's zone from their country (lib/country-timezone); null when the country is unknown. */
export const customerZone = (countryCode: string) => countryCode ? countryTimezone(countryCode) : null;

/** 「11/2 周一 02:14」 in a zone; the time is left out when it is not known. */
export function entryLabel(at: Date, zone: string, exact = true) {
  const { weekday } = clockIn(at, zone);
  return `${formatInTimeZone(at, zone, 'M/d')} ${WEEKDAYS[weekday]}${exact ? ` ${formatInTimeZone(at, zone, 'HH:mm')}` : ''}`;
}

/** UTC offset as people read it: 「UTC+1」「UTC−3」「UTC+5:30」. */
export function offsetLabel(at: Date, zone: string) {
  const raw = formatInTimeZone(at, zone, 'xxx');
  const [sign, hh, mm] = [raw[0], Number(raw.slice(1, 3)), raw.slice(4, 6)];
  if (raw === '+00:00') return 'UTC+0';
  return `UTC${sign === '-' ? '−' : '+'}${hh}${mm !== '00' ? `:${mm}` : ''}`;
}

/** How a lead came in. FORM: a Meta lead form (webhook or import); CTWA: tapped an ad and wrote on WhatsApp; WHATSAPP: wrote directly; MANUAL: entered by hand. */
export const ENTRY_CHANNELS = { FORM: '广告表单', CTWA: '点广告发 WhatsApp', WHATSAPP: 'WhatsApp 直接发', MANUAL: '手动录入' } as const;
export type EntryChannel = keyof typeof ENTRY_CHANNELS;
export function entryChannel(c: { source: string; submissions: number; formEvents: number; ctwa: boolean }): EntryChannel {
  if (c.submissions > 0 || c.formEvents > 0) return 'FORM';
  if (c.ctwa || c.source === 'META_CLICK_TO_WHATSAPP') return 'CTWA';
  if (c.source === 'WHATSAPP') return 'WHATSAPP';
  return 'MANUAL';
}
/** Where the entry time comes from, said once on the profile. */
export const ENTRY_TIME_SOURCE: Record<EntryChannel, string> = {
  FORM: '客户在 Meta 提交表单的时间，不是同步进系统的时间',
  CTWA: '客户第一条 WhatsApp 消息到达的时间',
  WHATSAPP: '客户第一条 WhatsApp 消息到达的时间',
  MANUAL: '录入时填的日期；当天录入的记录录入时刻，之前的日期只有日期没有钟点',
};

/** 「6 分钟」「3 小时 34 分」「2 天 5 小时」. */
export function waitText(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} 分钟`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分` : ''}`;
  const hours = Math.floor(m / 60);
  return `${Math.floor(hours / 24)} 天${hours % 24 ? ` ${hours % 24} 小时` : ''}`;
}

/** First-contact speed groups on the country card (A / B leads), by minutes from entry to our first message. */
export const CONTACT_SPEED_BUCKETS = [
  { key: 'm5', label: '5 分钟内', max: 5 },
  { key: 'm30', label: '5–30 分钟', max: 30 },
  { key: 'h2', label: '30 分钟–2 小时', max: 120 },
  { key: 'h10', label: '2–10 小时', max: 600 },
  { key: 'later', label: '更久 / 第二天', max: Infinity },
] as const;
export const contactSpeedBucket = (minutes: number) => CONTACT_SPEED_BUCKETS.findIndex(b => minutes <= b.max);
