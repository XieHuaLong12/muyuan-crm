'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowRight, Mail, MessageCircle, MessageSquare, Phone, UserRound, X } from 'lucide-react';
import { api, dateText, money } from '@/lib/client';
import { followTypes, purchases, sources } from '@/lib/constants';
import { inquiryDate } from '@/lib/customer-date';
import type { Customer, CustomerPreview as PreviewData } from '@/lib/types';
import { Badge, Due, GradeChip } from './customer-table';

const or = (value: string | number | null | undefined) => value === null || value === undefined || value === '' ? '—' : value;

/** The page's BOS root, so the drawer keeps the design tokens; outside any transformed wrapper, so it stays fixed. */
const drawerHost = () => document.querySelector<HTMLElement>('.bos') ?? document.body;

/**
 * Side preview opened from the customer column of the list, like a CRM record preview: key facts, quick actions and the
 * latest follow-ups without leaving the list. Not modal — clicking another customer switches the preview.
 */
export function CustomerPreview({ customer: row, tz, revision, autoFocus, onClose, onFollow }: {
  customer: Customer; tz: string; revision: number; autoFocus: boolean; onClose: () => void; onFollow: (c: Customer) => void;
}) {
  const [detail, setDetail] = useState<PreviewData>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const [host, setHost] = useState<HTMLElement>();
  const opener = useRef<HTMLElement | null>(null), focusInside = useRef(false);

  // Opened from the keyboard, focus moves into the preview; a mouse click leaves it on the list. Closing while focus is
  // inside the preview hands it back to the button that opened it.
  useEffect(() => {
    setHost(drawerHost());
    return () => { if (focusInside.current && opener.current?.isConnected) opener.current.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!host || !autoFocus) return;
    opener.current = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    // autoFocus only matters at the moment a customer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, row.id]);
  // Esc closes the preview from anywhere on the list; a dialog opened on top (e.g. 跟进) handles its own Esc first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    api<PreviewData>(`customers/${encodeURIComponent(row.id)}/preview`)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [row.id, revision, retry]);

  // The list row shows at once; the fresh preview replaces it when it arrives (only if it is still the same customer).
  const fresh = detail?.id === row.id ? detail : undefined;
  const c: Customer = fresh ? { ...row, ...fresh, contact: fresh.contact ?? row.contact } : row;
  const number = c.contact;
  const profile = `/customers/${c.id}`;
  const dealTotals = fresh ? Array.from(new Set(fresh.deals.map(d => d.currency))).map(currency =>
    money(fresh.deals.filter(d => d.currency === currency).reduce((sum, d) => sum + Number(d.dealAmount), 0), currency)) : [];

  const facts: [string, React.ReactNode][] = [
    ['阶段', <Badge key="stage" stage={c.stage} />],
    ['有效性', c.isQualified === null ? '待判断' : c.isQualified ? '有效' : `无效${c.invalidReason ? ` · ${c.invalidReason}` : ''}`],
    ['负责人', c.pendingAssignment ? '待分配' : or(c.owner?.name)],
    ['国家 / 城市', or([c.country, c.city].filter(Boolean).join(' / '))],
    ['来源', or(sources[c.source as keyof typeof sources] ?? c.source)],
    ['来源详情', or(c.sourceDetail)],
    ['WhatsApp', or(number?.display ?? c.whatsapp)],
    ['电话', or(c.phone)],
    ['邮箱', or(c.email)],
    ['意向产品', or([c.productInterest, c.productModel].filter(Boolean).join(' · '))],
    ['采购类型', or(purchases[c.purchaseType as keyof typeof purchases] ?? c.purchaseType)],
    ['采购数量', or(c.quantity || null)],
    ['预计金额', money(c.estimatedOrderValue, c.currency)],
    ['询盘日期', new Date(inquiryDate(c)).toLocaleDateString('zh-CN', { timeZone: tz })],
    ['最后跟进', dateText(c.lastFollowUpAt, tz)],
    ['下次跟进', <Due key="due" date={c.nextFollowUpAt} tz={tz} />],
  ];
  const actions = [
    { label: '跟进', icon: MessageSquare, onClick: () => onFollow(c) },
    { label: '消息', icon: MessageCircle, href: `/messages?customer=${encodeURIComponent(c.id)}` },
    { label: '呼叫', icon: Phone, href: number ? `tel:${number.copy}` : undefined },
    { label: '邮件', icon: Mail, href: c.email ? `mailto:${c.email}` : undefined },
    { label: '档案', icon: UserRound, href: profile },
  ];

  if (!host) return null;
  return createPortal(
    <aside ref={panel} className="bos-drawer customer-preview" role="dialog" aria-modal="false" aria-labelledby="customer-preview-name" tabIndex={-1}
      onFocus={() => { focusInside.current = true; }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusInside.current = false; }}>
      <header>
        <span className="customer-preview-title">预览</span>
        <button type="button" className="customer-preview-close" onClick={onClose} aria-label="关闭预览"><X size={20} aria-hidden /></button>
      </header>
      <div className="customer-preview-bar">
        <Link href={profile}>查看档案</Link>
        {c.pendingAssignment && <span className="badge">待分配</span>}
      </div>
      <div className="bos-drawer-body">
        <section className="customer-preview-identity">
          <span className="avatar large" aria-hidden>{c.name.slice(0, 1)}</span>
          <div>
            <h2 id="customer-preview-name"><Link href={profile}>{c.name}</Link><GradeChip grade={c.leadGrade} reason={c.leadGradeReason} source={c.leadGradeSource} /></h2>
            <p>{c.companyName || '未填写公司'}</p>
          </div>
        </section>
        <nav className="customer-preview-actions" aria-label="快捷操作">
          {actions.map(({ label, icon: Icon, href, onClick }) => {
            const body = <><span aria-hidden><Icon size={18} strokeWidth={1.6} /></span><small>{label}</small></>;
            if (onClick) return <button key={label} type="button" onClick={onClick}>{body}</button>;
            if (!href) return <span key={label} className="is-disabled" aria-disabled="true" title={`没有可用的${label === '呼叫' ? '电话号码' : '邮箱'}`}>{body}</span>;
            return href.startsWith('/') ? <Link key={label} href={href}>{body}</Link> : <a key={label} href={href}>{body}</a>;
          })}
        </nav>
        {error && <div role="alert" className="error-banner">{error}<button type="button" onClick={() => setRetry(v => v + 1)}>重试</button></div>}
        <details className="customer-preview-section" open>
          <summary>关键信息</summary>
          <dl>{facts.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
        </details>
        <details className="customer-preview-section" open>
          <summary>最近跟进{fresh ? ` · 共 ${fresh.followUpCount} 条` : ''}</summary>
          {loading && !fresh ? <PreviewSkeleton /> : fresh?.followUps.length ? (
            <ol className="customer-preview-follows">
              {fresh.followUps.map(f => (
                <li key={f.id}>
                  <strong>{followTypes[f.type as keyof typeof followTypes] ?? f.type}<span className="muted"> · {dateText(f.followUpAt, tz)}</span></strong>
                  <p>{f.content}</p>
                </li>
              ))}
            </ol>
          ) : !error && <p className="muted">还没有跟进记录。</p>}
        </details>
        <details className="customer-preview-section" open>
          <summary>成交与留资</summary>
          {loading && !fresh ? <PreviewSkeleton /> : fresh && (
            <dl>
              <div><dt>累计成交</dt><dd>{fresh.deals.length ? `${fresh.deals.length} 笔 · ${dealTotals.join(' + ')}` : '暂无成交'}</dd></div>
              <div><dt>最近成交</dt><dd>{dateText(fresh.deals[0]?.dealDate, tz)}</dd></div>
              <div><dt>留资次数</dt><dd>{fresh.submissionCount || '—'}</dd></div>
            </dl>
          )}
        </details>
        <details className="customer-preview-section" open>
          <summary>备注</summary>
          <p className="customer-preview-notes">{c.notes || <span className="muted">暂无备注</span>}</p>
        </details>
        {c.aiSummary && (
          <section className="bos-drawer-ai">
            <div><strong>AI 摘要（建议，仅供参考）</strong><p>{c.aiSummary}</p></div>
          </section>
        )}
      </div>
      <footer>
        <Link className="customer-preview-open" href={profile}>打开完整档案<ArrowRight size={16} aria-hidden /></Link>
      </footer>
    </aside>,
    host,
  );
}

function PreviewSkeleton() {
  return <div className="customer-preview-skeleton" role="status" aria-label="正在加载"><i /><i /><i /></div>;
}
