import type { inboxConversations, inboxThread, linkCandidates } from '@/services/inbox-service';
import type { ApprovedTemplate, VariableFill } from '@/services/whatsapp-template-service';

/** Server results after JSON: dates arrive as ISO strings. */
type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;

export type InboxList = Jsonify<Awaited<ReturnType<typeof inboxConversations>>>;
export type Conversation = InboxList['conversations'][number];
export type UnmatchedNumber = InboxList['numbers'][number];
export type PendingCustomer = InboxList['pending'][number];
export type Thread = Jsonify<Awaited<ReturnType<typeof inboxThread>>>;
export type ChatMessage = Thread['messages'][number];
export type LinkCandidate = Jsonify<Awaited<ReturnType<typeof linkCandidates>>>['candidates'][number];
export type TemplateList = { status: 'CONNECTED' | 'NOT_CONNECTED'; templates: ApprovedTemplate[]; suggestion: { templateId: string } | null; fills: Record<string, VariableFill[]>;
  /** The script the rotation assigned for the next touch, when it is a registered template. */
  outreach?: { position: string; scriptCode: string; templateId: string | null } | null };
export type Filter = 'all' | 'unread' | 'awaiting' | 'unmatched' | 'pending';

/** Request ids for idempotent sends; falls back to getRandomValues where randomUUID is unavailable (plain HTTP). */
export function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const toneOf = (id: string) => [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
export const initial = (name: string) => (name.trim()[0] || '?').toUpperCase();

export function formatListTime(iso: string, timezone: string, now = new Date()) {
  const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const date = new Date(iso), today = day(now), yesterday = day(new Date(now.getTime() - 86400000));
  if (day(date) === today) return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  if (day(date) === yesterday) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, month: 'numeric', day: 'numeric' }).format(date);
}
export const formatTime = (iso: string, timezone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const formatDay = (iso: string, timezone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(iso));
export const formatDateTime = (iso: string, timezone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** Hours and minutes left in the 24-hour window, e.g. "23:54". */
export function windowLeft(expiresAt: string | null, now = Date.now()) {
  if (!expiresAt) return null;
  const minutes = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 60000));
  return { minutes, text: `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` };
}

const span = (minutes: number) => minutes < 60 ? `${Math.max(1, Math.round(minutes))} 分钟` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时` : `${Math.round(minutes / 1440)} 天`;
/** First-contact deadline as the list shows it: "超时 12 分钟" once late, "剩 3 分钟" before, urgent under two hours. */
export function dueLabel(dueAt: string | null, now = Date.now()) {
  if (!dueAt) return null;
  const minutes = (Date.parse(dueAt) - now) / 60000;
  if (minutes < 0) return { text: `超时 ${span(-minutes)}`, tone: 'danger' as const };
  return { text: `剩 ${span(minutes)}`, tone: minutes < 120 ? 'warning' as const : 'neutral' as const };
}
