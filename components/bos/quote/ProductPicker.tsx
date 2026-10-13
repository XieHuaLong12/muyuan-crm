'use client';
import { useMemo, useRef, useState } from 'react';
import { Plus, Search as SearchIcon, PenLine } from 'lucide-react';
import type { CatalogVariant } from '@/services/itemized-quote-service';
import { suggestUnitPrice, type FxRates, type LastQuotedPrice, type QuoteLanguage } from '@/lib/quote-math';
import { formatAmount } from '@/lib/quote-i18n';

const MAX_RESULTS = 40;

/** 尺寸里的 x / * 统一成 ×，方便输入 270x180 也能搜到。 */
const normalize = (text: string) => text.toLowerCase().replace(/(\d)\s*[x*×]\s*(?=\d)/g, '$1×');

function matches(variant: CatalogVariant, tokens: string[]) {
  const haystack = normalize(`${variant.model} ${variant.label} ${variant.dims.zh} ${variant.category} ${variant.names.en}`);
  return tokens.every(token => haystack.includes(token));
}

/** 搜型号或尺寸，回车加入第一条；同一规格再次加入时数量 +1。 */
export function ProductPicker({ catalog, currency, language, fx, adjustPct, lastQuotes, initialQuery, onAdd, onAddCustom }: {
  catalog: CatalogVariant[];
  currency: string;
  language: QuoteLanguage;
  fx: FxRates;
  adjustPct: number;
  lastQuotes: Map<string, LastQuotedPrice>;
  initialQuery: string;
  onAdd: (variant: CatalogVariant) => void;
  onAddCustom: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const tokens = normalize(query.trim()).split(/\s+/).filter(Boolean);
    return catalog.filter(variant => matches(variant, tokens)).slice(0, MAX_RESULTS);
  }, [catalog, query]);

  const add = (variant: CatalogVariant) => {
    onAdd(variant);
    input.current?.focus();
  };

  return (
    <div className="bos-quote-picker">
      <div className="bos-quote-picker-bar">
        <label className="bos-search">
          <SearchIcon size={17} aria-hidden />
          <input
            ref={input}
            className="bos-input"
            type="search"
            aria-label="搜索产品型号或尺寸"
            placeholder="搜索型号或尺寸，例如 Y-601、270、床"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); add(results[0]); } }}
          />
        </label>
        <button type="button" className="bos-button" onClick={onAddCustom}><PenLine size={15} /> 自定义行</button>
      </div>
      <ul className="bos-quote-catalog" aria-label="产品规格">
        {results.map(variant => {
          const last = lastQuotes.get(`${variant.variantId}:${currency}`) ?? null;
          const suggestion = suggestUnitPrice({ prices: variant.prices, currency, fx, adjustPct, lastQuote: null });
          return (
            <li key={variant.variantId}>
              <button type="button" onClick={() => add(variant)} aria-label={`加入 ${variant.names[language]}`}>
                {variant.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/${variant.image}`} alt="" width={52} height={39} loading="lazy" />
                  : <span className="bos-quote-thumb-missing" aria-hidden>—</span>}
                <span className="bos-quote-catalog-name">
                  <strong>{variant.model}</strong>
                  <small>{variant.dims.zh || variant.label || '—'}{variant.cbm ? ` · ${variant.cbm} CBM` : ''}</small>
                </span>
                <span className="bos-quote-catalog-price">
                  {suggestion.price === null ? <small>无{currency}价</small> : <span>{currency} {formatAmount(suggestion.price, 'zh')}</span>}
                  {last && <small className="bos-quote-last">上次 {formatAmount(last.unitPrice, 'zh')}</small>}
                </span>
                <Plus size={16} aria-hidden />
              </button>
            </li>
          );
        })}
        {!results.length && <li className="bos-quote-option-empty">没有匹配的规格，可以点「自定义行」手动填写。</li>}
      </ul>
    </div>
  );
}
