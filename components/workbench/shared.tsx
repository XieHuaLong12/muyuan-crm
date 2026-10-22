import Link from 'next/link';
import { CATEGORIES, type Category } from '@/lib/outreach';

/** What a server value looks like after JSON: dates become strings. */
export type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;

export const dayTitle = (key: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${key}T00:00:00Z`));
export const shortDay = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
export const weekdayOf = (key: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${key}T00:00:00Z`));
export const categoryTag = (category: string) => CATEGORIES[category as Category] ?? category;
export const timeIn = (iso: string | null, timeZone: string) => iso ? new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '';
/** The local day (yyyy-MM-dd) of a moment. */
export const dayIn = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const zoneLabel = (timeZone: string) => timeZone === 'Asia/Shanghai' ? '北京时间' : timeZone;

const PAGES = [{ key: 'today', href: '/workbench', label: '今天' }, { key: 'review', href: '/workbench/review', label: '复盘' }, { key: 'history', href: '/workbench/history', label: '记录' }] as const;
/** 今天 · 复盘 · 记录: the three pages of the work calendar. */
export function WorkbenchNav({ current }: { current: (typeof PAGES)[number]['key'] }) {
  return <nav className="bos-wb-segment" aria-label="工作日历页面">
    {PAGES.map(p => <Link key={p.key} href={p.href} aria-current={p.key === current ? 'page' : undefined}>{p.label}</Link>)}
  </nav>;
}

/** A 1–5 rating as five dots. */
export function Dots({ label, value, onChange, disabled }: { label: string; value: number | null; onChange?: (value: number) => void; disabled?: boolean }) {
  return <fieldset className="bos-wb-dots"><legend>{label}</legend><span>
    {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" aria-pressed={value === n} aria-label={`${label} ${n} 分`} disabled={disabled || !onChange}
      className={value !== null && n <= value ? 'is-on' : ''} onClick={() => onChange?.(n)} />)}
  </span></fieldset>;
}
