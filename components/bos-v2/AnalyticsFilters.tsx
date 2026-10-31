'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';

/** `emptyLabel`: what no choice means for this field (「全部」 unless said otherwise). */
export type FilterField = { name: string; label: string; value: string; options: { value: string; label: string }[]; emptyLabel?: string };

/**
 * Filters for the analysis pages: each choice reloads the page with it in the address, so the link can be shared and
 * the period picker keeps it. `keep` holds the period, which the filters keep in turn.
 */
export function AnalyticsFilters({ basePath, keep, fields }: { basePath: string; keep: Record<string, string>; fields: FilterField[] }) {
  const router = useRouter();
  const values = Object.fromEntries(fields.filter(field => field.value).map(field => [field.name, field.value]));
  const go = (name: string, value: string) => {
    const params = new URLSearchParams({ ...keep, ...values });
    if (value) params.set(name, value); else params.delete(name);
    router.push(`${basePath}?${params}`);
  };
  return (
    <div className="analytics-filters" role="group" aria-label="筛选">
      <SlidersHorizontal size={16} aria-hidden />
      {fields.map(field => (
        <label key={field.name}>
          <span>{field.label}</span>
          <select value={field.value} onChange={event => go(field.name, event.target.value)}>
            <option value="">{field.emptyLabel ?? '全部'}</option>
            {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ))}
      {Object.keys(values).length > 0 && <Link href={`${basePath}?${new URLSearchParams(keep)}`}>清除筛选</Link>}
    </div>
  );
}
