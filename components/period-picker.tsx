import Link from 'next/link';
import { CalendarDays } from 'lucide-react';

const OPTIONS = [{ key: 'today', label: '今天' }, { key: 'week', label: '本周' }, { key: 'month', label: '本月' }, { key: 'quarter', label: '本季度' }, { key: 'year', label: '本年' }] as const;

/**
 * The one period selector for analysis pages (cockpit, sources and countries, finance, ad analytics). Every page
 * reads the same `range` / `startDate` / `endDate` parameters, and the section tabs carry them along, so switching
 * pages keeps the period. `keep` holds a page's other filters.
 */
export function PeriodPicker({ basePath, selected, keep = {} }: { basePath: string; selected: { range: string; startKey: string; endKey: string }; keep?: Record<string, string> }) {
  const href = (range: string) => `${basePath}?${new URLSearchParams({ ...keep, range })}`;
  return (
    <div className="cockpit-filter" aria-label="时间筛选">
      <CalendarDays size={16} />
      <div className="cockpit-filter-links">
        {OPTIONS.map(option => <Link key={option.key} href={href(option.key)} aria-current={selected.range === option.key ? 'page' : undefined}>{option.label}</Link>)}
      </div>
      <details className="cockpit-custom" open={selected.range === 'custom'}>
        <summary>自定义</summary>
        <form action={basePath}>
          {Object.entries(keep).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <input type="hidden" name="range" value="custom" />
          <label>开始<input aria-label="开始日期" type="date" name="startDate" defaultValue={selected.startKey} required /></label>
          <label>结束<input aria-label="结束日期" type="date" name="endDate" defaultValue={selected.endKey} required /></label>
          <button type="submit">应用</button>
        </form>
      </details>
    </div>
  );
}
