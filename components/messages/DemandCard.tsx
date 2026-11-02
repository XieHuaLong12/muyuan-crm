'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Pencil, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client';
import type { DemandProfile } from '@/services/demand-profile-service';

type Field = DemandProfile['fields'][number];

/**
 * 需求画像 in the chat's profile column (lib/demand-profile): what the customer wants, picked from their own words
 * by rules and AI, each with the words it came from. Values wait for a person to confirm (✓) or correct (改); only
 * confirmed ones go into the analysis and the quotation. For what is still unknown there is one question to ask,
 * which goes into the input box — nothing is sent from here.
 */
export function DemandCard({ customerId, lastInboundAt, canChat, onAsk }: { customerId: string; lastInboundAt: string | null; canChat: boolean; onAsk: (text: string) => void }) {
  const [data, setData] = useState<DemandProfile>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ field: string; value: string } | null>(null);
  const scanned = useRef<string | null>(null);

  const run = useCallback(async (call: () => Promise<DemandProfile>, what: string) => {
    setBusy(what); setError('');
    try { setData(await call()); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }, []);
  const scan = useCallback(() => run(() => api<DemandProfile>('insights/demand', 'POST', { customerId }), 'scan'), [customerId, run]);

  useEffect(() => {
    let live = true;
    setData(undefined); setEditing(null); setError('');
    api<DemandProfile>(`insights/demand?customerId=${encodeURIComponent(customerId)}`).then(d => {
      if (!live) return;
      setData(d);
      // The customer wrote since the last reading: read again once, for this chat and this newest message.
      const key = `${customerId}:${lastInboundAt ?? ''}`;
      if (d.stale && lastInboundAt && scanned.current !== key) { scanned.current = key; void scan(); }
    }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [customerId, lastInboundAt, scan]);

  const patch = (body: Record<string, string>, what: string) => run(() => api<DemandProfile>('insights/demand', 'PATCH', { customerId, ...body }), what);
  const shown = data?.fields.filter(f => f.value || data.question?.fields.includes(f.field as never)) ?? [];

  return (
    <div className="demand-card">
      <div className="bos-chat-section-title">
        <strong style={{ color: '#1c3226' }}>需求画像</strong>
        <span className="demand-actions">
          {!!data && data.total > data.confirmed && <button type="button" className="bos-chat-link" disabled={!!busy} onClick={() => void patch({ action: 'confirmAll' }, 'all')}>全部确认</button>}
          <button type="button" className="bos-chat-link" disabled={!!busy} onClick={() => void scan()} title="重新从聊天里摘一遍">
            {busy === 'scan' ? <Loader2 size={13} aria-hidden /> : <RefreshCw size={13} aria-hidden />}{busy === 'scan' ? '读取中' : '重读'}</button>
        </span>
      </div>
      {data && <p className="demand-meta">已确认 {data.confirmed} / {data.total} · 客户发了新消息会自动再读{data.aiConfigured ? '（AI + 规则）' : '（规则，配置 DeepSeek 后加上 AI）'}</p>}
      {!data && !error && <p className="demand-meta">正在读取…</p>}
      {error && <p className="bos-chat-error" role="alert">{error}</p>}
      {data?.aiError && <p className="demand-meta">AI 这次没读成（{data.aiError}），先用规则摘出的结果。</p>}
      {data && !shown.length && <p className="bos-chat-hint" style={{ display: 'block' }}>客户还没说具体需求。</p>}
      <ul className="demand-fields">
        {shown.map(f => <DemandRow key={f.field} f={f} busy={!!busy} editing={editing?.field === f.field ? editing.value : null}
          onEdit={value => setEditing(value === null ? null : { field: f.field, value })}
          onConfirm={() => void patch({ action: 'confirm', field: f.field }, f.field)}
          onSave={value => { setEditing(null); void patch({ action: 'set', field: f.field, value }, f.field); }} />)}
      </ul>
      {data?.question && <div className="demand-ask">
        <span>还不知道{data.question.fields.map(key => data.fields.find(f => f.field === key)?.label).join('、')} · 可以这样问（你确认后再发）</span>
        <p>{data.question.text}</p>
        <small>{data.question.zh}</small>
        <button type="button" className="bos-chat-link" disabled={!canChat} onClick={() => onAsk(data.question!.text)}>放进输入框 →</button>
      </div>}
      {data && <div className={`demand-quote${data.quote.ready ? ' is-ready' : ''}`}>
        <span><strong>{data.quote.ready ? '可以出报价单了' : `确认${data.quote.missing.join('、')}后就能出报价单`}</strong>
          <small>价格、起订量、交期从产品库带出，客户提到的价格只做参考</small></span>
        {data.quote.ready ? <Link href={data.quote.href}>生成报价单</Link> : <span className="demand-quote-off" aria-disabled="true">生成报价单</span>}
      </div>}
    </div>
  );
}

function DemandRow({ f, busy, editing, onEdit, onConfirm, onSave }: {
  f: Field; busy: boolean; editing: string | null; onEdit: (value: string | null) => void; onConfirm: () => void; onSave: (value: string) => void;
}) {
  const missing = !f.value, done = f.status === 'CONFIRMED';
  return (
    <li className={`demand-row${missing ? ' is-missing' : done ? ' is-done' : ''}`}>
      <span className="demand-label">{f.label}</span>
      {editing !== null ? (
        <form className="demand-edit" onSubmit={e => { e.preventDefault(); onSave(editing.trim()); }}>
          <input autoFocus value={editing} maxLength={200} onChange={e => onEdit(e.target.value)} aria-label={`${f.label}`} placeholder="清空后保存表示删除这一项" />
          <button type="submit" disabled={busy}>保存</button><button type="button" onClick={() => onEdit(null)}>取消</button>
        </form>
      ) : (
        <span className="demand-value">
          <strong>{missing ? '—' : f.value}</strong>
          <small title={f.evidence || undefined}>{missing ? '还没聊到' : f.source === 'HUMAN' ? '你填的' : f.evidence ? `「${f.evidence}」` : ''}</small>
        </span>
      )}
      {editing === null && <span className="demand-buttons">
        {missing ? <button type="button" className="demand-mini" onClick={() => onEdit('')} disabled={busy}>填写</button> : <>
          <button type="button" className="demand-mini" onClick={() => onEdit(f.value)} disabled={busy} aria-label={`改${f.label}`}><Pencil size={11} aria-hidden />改</button>
          {done ? <span className="demand-done">已确认</span>
            : <button type="button" className="demand-mini is-primary" onClick={onConfirm} disabled={busy} aria-label={`确认${f.label}`}><Check size={12} aria-hidden /></button>}
        </>}
      </span>}
    </li>
  );
}
