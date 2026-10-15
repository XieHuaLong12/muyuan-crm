'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Columns3, Search } from 'lucide-react';
import { api } from '@/lib/client';
import { sources, stages } from '@/lib/constants';
import type { Bootstrap, Customer, CustomerPage } from '@/lib/types';
import { DEFAULT_CUSTOMER_COLUMNS, type CustomerColumnKey } from '@/lib/customer-columns';
import { Options } from './forms';
import { BatchCustomerTable } from './customer-batch';
import { ColumnPicker } from './customer-columns';
import { CustomerPreview } from './customer-preview';

/** Remembered so "back to list" from a customer returns to the same filters and page. */
export const LIST_URL_KEY = 'crm:customer-list-url';
export function rememberedListUrl() {
  try { return sessionStorage.getItem(LIST_URL_KEY) || '/customers'; } catch { return '/customers'; }
}

const FILTER_KEYS = ['q', 'stage', 'country', 'source', 'owner', 'product', 'grade', 'from', 'to', 'wonFrom', 'wonTo', 'qualified', 'behavior', 'period', 'date', 'assign'] as const;

/**
 * Customer list whose filters, sort and page live in the URL: they survive refreshes, opening a customer
 * and coming back, and can be shared. Filtering, sorting and paging happen on the server.
 * Each user picks their own columns (「定制列」); the customer column opens a side preview.
 */
export function CustomerList({ boot, revision, initialColumns, onFollow, onChanged }: {
  boot: Bootstrap; revision: number; initialColumns?: readonly CustomerColumnKey[]; onFollow: (c: Customer) => void; onChanged: (message: string) => void;
}) {
  const pathname = usePathname(), params = useSearchParams();
  const admin = boot.user.role === 'ADMIN';
  const tz = boot.settings.timezone;
  const query = params.toString();
  const get = (key: string) => params.get(key) ?? '';
  const [data, setData] = useState<CustomerPage>();
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [search, setSearch] = useState(get('q'));
  const [columns, setColumns] = useState<readonly CustomerColumnKey[]>(initialColumns ?? DEFAULT_CUSTOMER_COLUMNS);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState<{ customer: Customer; fromKeyboard: boolean }>();

  const update = (patch: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    if (resetPage) next.delete('page');
    const qs = next.toString();
    // Native history keeps useSearchParams in sync without re-rendering the server page; only the list API is called.
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  };

  useEffect(() => { setSearch(params.get('q') ?? ''); }, [params]);
  useEffect(() => {
    const timer = setTimeout(() => { if (search !== (params.get('q') ?? '')) update({ q: search }); }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => {
    try { sessionStorage.setItem(LIST_URL_KEY, `${pathname}${query ? `?${query}` : ''}`); } catch { /* private mode */ }
    let cancelled = false;
    setLoading(true); setError('');
    api<CustomerPage>(`customers${query ? `?${query}` : ''}`)
      .then(page => { if (!cancelled) setData(page); })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pathname, query, revision, retry]);

  const page = Number(get('page') || 1), pageSize = Number(get('pageSize') || 10);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const sort = get('sort') || 'priority', dir = get('dir') || 'asc';
  const tabs = useMemo(() => [
    { key: 'all', label: admin ? '全部客户' : '我的全部客户' },
    ...(admin ? [{ key: 'assign', label: `待分配${data?.pool ? ` ${data.pool}` : ''}` }] : []),
    { key: 'NEW', label: stages.NEW }, { key: 'QUOTED', label: stages.QUOTED },
    { key: 'FOLLOW_UP', label: stages.FOLLOW_UP }, { key: 'WON', label: stages.WON }, { key: 'PAUSED', label: stages.PAUSED }, { key: 'INVALID', label: stages.INVALID },
  ], [admin, data?.pool]);
  const activeTab = get('assign') === 'pending' ? 'assign' : get('stage') || 'all';
  const filtersActive = FILTER_KEYS.some(key => params.get(key));
  const select = (label: string, key: string, values: string[] | Record<string, string>) => (
    <select aria-label={label} value={get(key)} onChange={e => update({ [key]: e.target.value })}>
      <option value="">全部{label}</option>
      {Array.isArray(values) ? values.map(v => <option key={v} value={v}>{v}</option>) : <Options items={values} />}
    </select>
  );
  const ownerOptions = Object.fromEntries(boot.users.map(u => [u.id, `${u.name}${u.isActive === false ? '（已停用）' : ''}`]));
  // The previewed customer follows list reloads (stage changes, follow-ups) while it is on the page.
  const previewRow = preview && (data?.rows.find(c => c.id === preview.customer.id) ?? preview.customer);

  return (
    <section className="card customer-card">
      <div className="tabs" role="tablist" aria-label="客户分组">
        {tabs.map(tab => (
          <button key={tab.key} role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? 'active' : ''}
            onClick={() => update(tab.key === 'assign' ? { assign: 'pending', stage: '' } : { stage: tab.key === 'all' ? '' : tab.key, assign: '' })}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="filters">
        <div className="search"><Search size={17} /><input id="workspace-search" placeholder="搜索姓名、公司、联系方式…" value={search} onChange={e => setSearch(e.target.value)} aria-label="搜索客户" /></div>
        {select('阶段', 'stage', stages)}
        {select('国家', 'country', data?.countries ?? [])}
        {select('来源', 'source', sources)}
        {select('表单等级', 'grade', { A: 'A 优质', B: 'B 良好', C: 'C 一般', D: 'D 无效', none: '未评级' })}
        {admin && select('负责人', 'owner', ownerOptions)}
        <input aria-label="产品筛选" placeholder="产品 / 型号" defaultValue={get('product')} key={`product-${get('product')}`}
          onBlur={e => { if (e.target.value !== get('product')) update({ product: e.target.value }); }}
          onKeyDown={e => { if (e.key === 'Enter') update({ product: (e.target as HTMLInputElement).value }); }} />
        <details open={!!(get('from') || get('to') || get('wonFrom') || get('wonTo'))}>
          <summary>日期筛选</summary>
          <div className="date-filters">
            {([['from', '询盘起始'], ['to', '询盘截止'], ['wonFrom', '成交起始'], ['wonTo', '成交截止']] as const).map(([key, label]) => (
              <label key={key}>{label}<input type="date" value={get(key)} onChange={e => update({ [key]: e.target.value })} /></label>
            ))}
          </div>
        </details>
        {filtersActive && <button className="text-button" onClick={() => { setSearch(''); window.history.replaceState(null, '', pathname); }}>清除筛选</button>}
      </div>
      {get('period') && <div className="filter-hint">已按 {get('date')} 所在周期的新增客户筛选</div>}
      {activeTab === 'assign' && <div className="filter-hint">自动进入的线索在这里等待分配，请尽快处理：勾选客户后点击「分配 / 转交」。分配后开始计算首联期限，24 小时内的广告留资须在 {boot.settings.adLeadFirstContactMinutes ?? 5} 分钟内联系。</div>}
      {error && <div role="alert" className="error-banner">{error}<button onClick={() => setRetry(v => v + 1)}>重试</button></div>}
      {loading && !data ? <div className="loading">正在加载客户…</div> : (
        <div aria-busy={loading}>
          <BatchCustomerTable key={FILTER_KEYS.map(key => params.get(key)).join('|')} rows={data?.rows ?? []} tz={tz} boot={boot} onFollow={onFollow}
            columns={columns} previewId={previewRow?.id} onPreview={(customer, fromKeyboard = false) => setPreview({ customer, fromKeyboard })}
            tools={<button type="button" className="column-button" onClick={() => setPicking(true)}><Columns3 size={15} aria-hidden />定制列</button>}
            onSort={key => update({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' })} onChanged={onChanged} />
        </div>
      )}
      <div className="pagination">
        <span>共 {data?.total ?? 0} 位客户</span>
        <div>
          <label className="page-size">每页
            <select aria-label="每页显示客户数量" value={pageSize} onChange={e => update({ pageSize: e.target.value === '10' ? '' : e.target.value })}>
              <option value={10}>10</option><option value={50}>50</option><option value={100}>100</option>
            </select>位
          </label>
          <button aria-label="上一页" disabled={page <= 1} onClick={() => update({ page: page - 1 > 1 ? String(page - 1) : '' }, false)}><ChevronLeft size={16} /></button>
          <span>{page} / {pages}</span>
          <button aria-label="下一页" disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, false)}><ChevronRight size={16} /></button>
        </div>
      </div>
      {picking && <ColumnPicker value={columns} onClose={() => setPicking(false)}
        onSaved={view => { setColumns(view.columns); setPicking(false); onChanged(view.custom ? '列设置已保存，只对你自己生效' : '已恢复默认列'); }} />}
      {preview && previewRow && <CustomerPreview customer={previewRow} tz={tz} revision={revision} autoFocus={preview.fromKeyboard}
        onClose={() => setPreview(undefined)} onFollow={onFollow} />}
    </section>
  );
}
