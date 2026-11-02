'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/client';
import { invalidReasons, pipeline, stages } from '@/lib/constants';
import { KANBAN_REASON_STAGES } from '@/lib/bos-kanban';
import { dayKey } from '@/lib/time';
import { formatDateTime } from './types';

// Short enough for seven steps in the profile column; the full name is in the title, the label and the header.
const SHORT: Record<string, string> = { NEW: '新线索', CONTACTED: '已联系', REPLIED: '已回复', NEEDS_CONFIRMED: '需求', QUOTED: '已报价', FOLLOW_UP: '跟进中', WON: '成交' };
/** Stages between two steps of the main line, shown as having reached the step before. */
const SIDE_AT: Record<string, number> = { CATALOG_SENT: 2, PRODUCT_CONFIRMED: 3, ORDER: 5 };
const REASONS: Record<string, readonly string[]> = {
  PAUSED: ['明年再采购', '预算未定', '等市场反馈', '其他'],
  LOST: ['价格太高', '运费太贵', '起订量太高', '选了别家', '交期不合适', '不再回复', '其他'],
  INVALID: invalidReasons,
};
const UNDO_MS = 6000;
const label = (stage: string) => stages[stage as keyof typeof stages] ?? stage;

type LastChange = { by: string; changedAt: string; toStage: string } | null;
type LossHint = { hint: { reason: string; quote: string; at: string | null; competitorPrice: string } | null; ourPrice: string };

/**
 * 销售阶段 in the chat's profile: every step of the main line is a button that changes the stage at once (an
 * 「撤销」 stays for six seconds); 其他阶段 holds the in-between stages and the three that end follow-up, which need a
 * reason as on the board. 成交 always comes with a deal, so it opens the deal form here instead of changing the
 * stage. The same rules as the board (services/bos-crm-service moveCustomerStage, customer-service addDeal).
 */
export function StageControl({ customerId, stage: saved, hasDeal, invalidReason, currency, last, timezone, onChanged }: {
  customerId: string; stage: string; hasDeal: boolean; invalidReason: string; currency: string; last: LastChange; timezone: string; onChanged: () => void;
}) {
  const [more, setMore] = useState(false), [pending, setPending] = useState<string | null>(null), [reason, setReason] = useState(''), [note, setNote] = useState('');
  const [deal, setDeal] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // 流失原因 pre-pick (lib/demand-profile lossHint): what the customer's words point to, a competitor price they named, our quoted price.
  const [hint, setHint] = useState<LossHint | null>(null), [competitor, setCompetitor] = useState('');
  const [toast, setToast] = useState<{ text: string; undo: { from: string; to: string; reason: string } | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // A change shows at once and is what the next click starts from, until the reloaded chat brings the saved stage.
  const [moved, setMoved] = useState<{ over: string; to: string } | null>(null);
  const stage = moved && moved.over === saved ? moved.to : saved;
  const won = hasDeal || stage === 'WON';
  const ended = KANBAN_REASON_STAGES.includes(stage as never);
  const at = pipeline.indexOf(stage as (typeof pipeline)[number]);
  const reached = at >= 0 ? at : SIDE_AT[stage] ?? -1;

  function show(text: string, undo: { from: string; to: string; reason: string } | null) {
    clearTimeout(timer.current);
    setToast({ text, undo });
    timer.current = setTimeout(() => setToast(null), UNDO_MS);
  }
  async function move(to: string, why = '', undoing = false) {
    if (busy || to === stage) return;
    setBusy(true); setError('');
    try {
      await api('bos/crm-stage', 'PATCH', { customerId, fromStage: stage, toStage: to, reason: why });
      setMoved({ over: saved, to });
      setPending(null); setReason(''); setNote(''); setDeal(false);
      show(undoing ? `已撤销，回到「${label(to)}」` : `已改为「${label(to)}」`, undoing ? null : { from: stage, to, reason: invalidReason });
      onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function pick(to: string) {
    if (won) return;
    if (to === 'WON') { setDeal(true); setPending(null); return; }
    if (KANBAN_REASON_STAGES.includes(to as never)) {
      setPending(to); setReason(''); setNote(''); setDeal(false); setHint(null); setCompetitor('');
      if (to === 'LOST' || to === 'PAUSED') api<LossHint>(`insights/loss-hint?customerId=${encodeURIComponent(customerId)}`).then(h => {
        setHint(h);
        if (h.hint && REASONS[to].includes(h.hint.reason)) setReason(current => current || h.hint!.reason);
        if (h.hint?.competitorPrice) setCompetitor(current => current || h.hint!.competitorPrice);
      }).catch(() => undefined);
      return;
    }
    void move(to);
  }
  const undo = () => {
    const previous = toast?.undo;
    if (!previous) return;
    // Going back into 暂不需要 / 已流失 / 无效 needs a reason: the one it had.
    void move(previous.from, KANBAN_REASON_STAGES.includes(previous.from as never) ? previous.reason || '撤销误改' : '', true);
  };

  return <div className="bos-chat-stage">
    <div className="bos-chat-section-title"><span>销售阶段</span>
      <strong className={ended ? 'is-ended' : undefined}>{label(stage)}{at >= 0 ? ` · 第 ${at + 1} / ${pipeline.length} 步` : ended ? ' · 已结束跟进' : ''}</strong></div>
    <div className="bos-chat-steps" role="group" aria-label="点一步改销售阶段">
      {pipeline.map((key, i) => <button key={key} type="button" disabled={won || busy} aria-current={key === stage ? 'step' : undefined} onClick={() => pick(key)}
        className={`${!ended && i <= reached ? 'is-done' : ''}${key === stage ? ' is-current' : ''}`} aria-label={key === 'WON' ? '成交：登记成交' : `改为${label(key)}`} title={key === 'WON' ? '登记成交' : label(key)}>
        <span aria-hidden="true" /><small>{SHORT[key]}</small>
      </button>)}
    </div>
    {ended && <p className="bos-chat-stage-ended">{label(stage)}{invalidReason ? ` · 原因：${invalidReason}` : ''}。点上面任意一步可以恢复跟进。</p>}
    {won && <p className="bos-chat-hint" style={{ display: 'block' }}>已成交：阶段跟着成交记录走，要改请在客户档案里处理成交。</p>}
    <div className="bos-chat-stage-foot">
      <span>{last ? `${last.by} · ${formatDateTime(last.changedAt, timezone)} 改为${label(last.toStage)}` : ''}</span>
      {!won && <button type="button" className="bos-chat-link" aria-expanded={more} onClick={() => setMore(v => !v)}>{more ? <>收起<ChevronUp size={13} aria-hidden="true" /></> : <>其他阶段<ChevronDown size={13} aria-hidden="true" /></>}</button>}
    </div>
    {more && !won && <div className="bos-chat-stage-more">
      <small>中间步骤</small>
      <div className="bos-chat-stage-chips">{Object.keys(SIDE_AT).map(key => <button key={key} type="button" aria-pressed={stage === key} disabled={busy} onClick={() => pick(key)}>{label(key)}</button>)}</div>
      <small>结束跟进（要选原因）</small>
      <div className="bos-chat-stage-chips is-end">{KANBAN_REASON_STAGES.map(key => <button key={key} type="button" aria-pressed={stage === key || pending === key} disabled={busy} onClick={() => pick(key)}>{label(key)}</button>)}</div>
    </div>}
    {pending && <form className="bos-chat-stage-form is-reason" onSubmit={e => { e.preventDefault(); if (reason) void move(pending, [reason, pending === 'LOST' && competitor.trim() ? `别家 ${competitor.trim()}` : '', note.trim()].filter(Boolean).join('：').slice(0, 190)); }}>
      <strong>改为「{label(pending)}」，原因是？</strong>
      <div className="bos-chat-stage-chips is-end" role="radiogroup" aria-label="原因">{REASONS[pending].map(r => <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}>{r}{hint?.hint?.reason === r ? ' · 按聊天预选' : ''}</button>)}</div>
      {hint?.hint && <p className="loss-hint">按聊天预选「{hint.hint.reason}」：{hint.hint.at ? `客户 ${formatDateTime(hint.hint.at, timezone)} 说` : ''}「{hint.hint.quote}」</p>}
      {pending === 'LOST' && <div className="loss-prices">
        <label>对方说的别家价格（可选）<input value={competitor} maxLength={40} onChange={e => setCompetitor(e.target.value)} placeholder="比如 €72 / 张" /></label>
        <span><small>我们报的价格</small><b>{hint?.ourPrice || '还没发过报价单'}</b></span>
      </div>}
      <label>补充一句（可选）<input value={note} maxLength={120} onChange={e => setNote(e.target.value)} placeholder="比如：要的是 C-301 的价格" /></label>
      <div className="bos-chat-actions"><button type="submit" className="is-primary" disabled={!reason || busy}>确认改为{label(pending)}</button><button type="button" onClick={() => setPending(null)}>取消</button></div>
    </form>}
    {deal && <DealForm customerId={customerId} currency={currency} timezone={timezone} onCancel={() => setDeal(false)}
      onDone={() => { setDeal(false); show('已登记成交，阶段改为「已成交」', null); onChanged(); }} />}
    {error && <p className="bos-chat-error" role="alert">{error}</p>}
    {toast && <div className="bos-chat-toast" role="status"><span>{toast.text}</span>{toast.undo && <button type="button" onClick={undo} disabled={busy}>撤销</button>}</div>}
  </div>;
}

/** 登记成交 without leaving the chat: amount, cost, currency and date, as on the customer page. */
function DealForm({ customerId, currency, timezone, onCancel, onDone }: { customerId: string; currency: string; timezone: string; onCancel: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ dealAmount: '', productCost: '', currency: ['CNY', 'USD', 'EUR'].includes(currency) ? currency : 'USD', dealDate: dayKey(new Date(), timezone) });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(`customers/${encodeURIComponent(customerId)}/deals`, 'POST', form); onDone(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form className="bos-chat-stage-form is-deal" onSubmit={save}>
    <strong>登记成交，阶段会改为「已成交」</strong>
    <div className="bos-chat-stage-grid">
      <label>成交金额<input inputMode="decimal" required value={form.dealAmount} onChange={set('dealAmount')} /></label>
      <label>币种<select value={form.currency} onChange={set('currency')}><option value="CNY">CNY</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
      <label>成交日期<input type="date" required value={form.dealDate} onChange={set('dealDate')} /></label>
      <label>产品成本<input inputMode="decimal" required value={form.productCost} onChange={set('productCost')} /></label>
    </div>
    {error && <p className="bos-chat-error" role="alert">{error}</p>}
    <div className="bos-chat-actions"><button type="submit" className="is-primary" disabled={busy}>{busy ? '保存中…' : '登记成交'}</button><button type="button" onClick={onCancel}>取消</button></div>
  </form>;
}
