'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FilePlus2, FileText, Check } from 'lucide-react';
import { api } from '@/lib/client';
import type { Customer } from '@/lib/types';
import type { PriceHistoryRow, QuoteList } from '@/services/itemized-quote-service';
import { formatAmount } from '@/lib/quote-i18n';

/**
 * 客户档案里的报价：这个客户收到过的每一份报价单，以及每个规格报过的价格。
 * 新建报价进入「产品库 → 报价单」，自动带出该客户上次的价格，避免前后报价不一致。
 */
export function QuotationPanel({ customer }: { customer: Customer }) {
  const [quotes, setQuotes] = useState<QuoteList['rows']>([]);
  const [history, setHistory] = useState<PriceHistoryRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api<QuoteList>(`quotes?customerId=${encodeURIComponent(customer.id)}`),
      api<PriceHistoryRow[]>(`quotes/price-history?customerId=${encodeURIComponent(customer.id)}`),
    ])
      .then(([list, prices]) => { if (active) { setQuotes(list.rows); setHistory(prices); setError(''); } })
      .catch(e => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [customer.id]);

  // 每个规格（同币种）只保留最近一次报价
  const latestPrices = useMemo(() => {
    const seen = new Set<string>();
    return history.filter(row => {
      const key = `${row.variantId ?? row.name}:${row.currency}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [history]);

  async function markSent(id: string) {
    setBusy(id);
    try {
      await api(`quotations/${id}`, 'PATCH');
      setQuotes(current => current.map(q => (q.id === id ? { ...q, status: 'SENT', sentAt: new Date().toISOString() } : q)));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const prices = showAll ? latestPrices : latestPrices.slice(0, 8);

  return (
    <section className="bos-quote-panel">
      <div className="card-title">
        <h3>报价单</h3>
        <Link className="bos-button bos-button-primary" href={`/products/quotes/new?customerId=${customer.id}`}><FilePlus2 size={15} /> 新建报价</Link>
      </div>
      {loading && <p className="muted">正在读取报价…</p>}
      {!loading && !quotes.length && !error && (
        <div className="empty">还没有给这个客户报过价。点「新建报价」，从产品库选型号即可生成中英文报价单。</div>
      )}
      {quotes.length > 0 && (
        <ul className="bos-quote-panel-list">
          {quotes.map(q => (
            <li key={q.id}>
              <Link href={`/products/quotes/${q.id}`}>
                <FileText size={16} aria-hidden />
                <span>
                  <strong>{q.quoteNumber}</strong>
                  <small>{q.product} · {q.createdAt.slice(0, 10)}</small>
                </span>
                <span className="bos-quote-panel-amount">{q.currency} {formatAmount(Number(q.amount), 'zh')}</span>
              </Link>
              {q.status === 'SENT'
                ? <span className="bos-badge bos-badge-green"><Check size={11} /> 已发送</span>
                : <button type="button" className="bos-button" disabled={busy === q.id} onClick={() => void markSent(q.id)}>登记已发送</button>}
            </li>
          ))}
        </ul>
      )}
      {latestPrices.length > 0 && (
        <>
          <h3 className="bos-quote-panel-sub">报过的价格 <small>每个规格最近一次，避免前后报价不一致</small></h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th>型号 / 规格</th><th>单价</th><th>数量</th><th>报价单</th></tr></thead>
              <tbody>
                {prices.map(row => (
                  <tr key={`${row.quoteId}-${row.variantId ?? row.name}-${row.currency}`}>
                    <td>{row.name}</td>
                    <td><strong>{row.currency} {formatAmount(row.unitPrice, 'zh')}</strong></td>
                    <td>{row.quantity}</td>
                    <td><Link href={`/products/quotes/${row.quoteId}`}>{row.quoteNumber}</Link><small>{row.date}{row.status === 'SENT' ? ' · 已发送' : ' · 草稿'}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {latestPrices.length > 8 && (
            <button type="button" className="text-button" onClick={() => setShowAll(!showAll)}>{showAll ? '收起' : `查看全部 ${latestPrices.length} 个规格`}</button>
          )}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
