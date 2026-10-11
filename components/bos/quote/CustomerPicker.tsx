'use client';
import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { UserRound, X } from 'lucide-react';
import { api } from '@/lib/client';
import type { QuoteCustomer } from '@/services/itemized-quote-service';

/** 报价必须挂在客户名下：从自己负责的客户里搜索选择（管理员可选全部客户）。 */
export function CustomerPicker({ value, onChange, locked }: { value: QuoteCustomer | null; onChange: (customer: QuoteCustomer | null) => void; locked?: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QuoteCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const listId = useId();

  useEffect(() => {
    if (value || !open) return;
    let active = true;
    const timer = setTimeout(() => {
      api<QuoteCustomer[]>(`quotes/customers?q=${encodeURIComponent(query)}`)
        .then(rows => { if (active) { setResults(rows); setError(''); } })
        .catch(e => active && setError((e as Error).message));
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [query, open, value]);

  if (value) {
    return (
      <div className="bos-quote-customer-chip">
        <span className="bos-quote-avatar" aria-hidden>{value.name.slice(0, 1)}</span>
        <div>
          <strong>{value.name}</strong>
          <small>{[value.companyName, value.country, value.phone].filter(Boolean).join(' · ') || '—'}</small>
          <small>{value.quoteCount ? `已有 ${value.quoteCount} 份报价，历史价格会自动带出` : '首次报价'}</small>
        </div>
        {!locked && (
          <button type="button" className="bos-button bos-button-ghost" onClick={() => { onChange(null); setQuery(''); setOpen(true); }} aria-label="更换客户">
            <X size={15} /> 更换
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bos-quote-combobox">
      <label className="bos-search">
        <UserRound size={17} aria-hidden />
        <input
          className="bos-input"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label="搜索客户"
          placeholder="搜索客户姓名、公司、WhatsApp 或国家"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); onChange(results[0]); } }}
        />
      </label>
      {open && (
        <ul id={listId} className="bos-quote-options" role="listbox" aria-label="客户">
          {results.map(customer => (
            <li key={customer.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => onChange(customer)}>
                <strong>{customer.name}</strong>
                <small>{[customer.companyName, customer.country, customer.phone].filter(Boolean).join(' · ') || '—'}</small>
                {customer.quoteCount > 0 && <em>{customer.quoteCount} 份报价</em>}
              </button>
            </li>
          ))}
          {!results.length && !error && <li className="bos-quote-option-empty">没有匹配的客户。<Link href="/customers" target="_blank">去客户列表新建</Link>后回来刷新。</li>}
          {error && <li className="bos-quote-option-empty bos-sales-error" role="alert">{error}</li>}
        </ul>
      )}
    </div>
  );
}
