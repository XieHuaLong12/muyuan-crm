import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';

/** Shared pieces of 客户分析 and 消息分析: numbers, change wording, KPI cards and section heads. */
export const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
export const percent = (value: number | null) => value === null ? '—' : `${value}%`;
/** 「↑ 22%」 / 「↓ 5%」, or null without a comparison. */
export const changeText = (value: number | null) => value === null ? null : `${value >= 0 ? '↑' : '↓'} ${Math.abs(value)}%`;
/** 「↑ 6 个百分点」 for a change between two rates. */
export const pointsText = (value: number | null) => value === null ? null : value === 0 ? '持平' : `${value > 0 ? '↑' : '↓'} ${Math.abs(value)} 个百分点`;
/** Minutes as people say them: 「6 分钟」「2.5 小时」「超过 1 天」. */
export function minutesText(minutes: number | null) {
  if (minutes === null) return '—';
  if (minutes === Infinity || minutes > 1440) return '超过 1 天';
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.round(minutes / 6) / 10} 小时`;
}

export function SectionHead({ title, detail, href, action }: { title: string; detail?: string; href?: string; action?: string }) {
  return (
    <div className="cockpit-section-head">
      <div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>
      {href && <Link href={href}>{action || '查看名单'} <ArrowUpRight size={14} aria-hidden /></Link>}
    </div>
  );
}

/** One KPI card. `tone` up/down colours the comparison; `alert` marks a number that needs action now. */
export function Kpi({ label, value, unit, detail, compare, tone, alert, children, action }: {
  label: string; value: string; unit?: string; detail?: ReactNode; compare?: string | null; tone?: 'up' | 'down' | null; alert?: boolean;
  children?: ReactNode; action?: { href: string; label: string } | null;
}) {
  return (
    <section className={`cockpit-kpi analytics-kpi${alert ? ' is-alert' : ''}`} aria-label={label}>
      <span className="cockpit-kpi-label">{label}</span>
      <strong>{value}{unit && <small>{unit}</small>}</strong>
      {children}
      {detail && <span className="analytics-kpi-detail">{detail}</span>}
      {compare && <span className="cockpit-kpi-detail">{tone ? <em className={tone === 'up' ? 'is-up' : 'is-down'}>{compare}</em> : compare}</span>}
      {action && <Link className="analytics-kpi-action" href={action.href}>{action.label} →</Link>}
    </section>
  );
}

/** The direction a change goes, for colouring: more is better unless `lowerIsBetter`. */
export const toneOf = (value: number | null, lowerIsBetter = false) => value === null || value === 0 ? null : (value > 0) !== lowerIsBetter ? 'up' as const : 'down' as const;
