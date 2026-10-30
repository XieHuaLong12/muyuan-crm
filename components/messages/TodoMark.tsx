'use client';
import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { api } from '@/lib/client';
import { dayKey, localDate } from '@/lib/time';
import { formatDateTime } from './types';

type Mark = { note: string; dueAt: string } | null;

/** The reminder times offered: now, this evening (while it is still ahead), tomorrow morning, or any time. */
function choices(timezone: string, now = new Date()) {
  const today = dayKey(now, timezone), tomorrow = dayKey(new Date(now.getTime() + 86400_000), timezone);
  const evening = localDate(`${today}T18:00`, timezone), morning = localDate(`${tomorrow}T09:00`, timezone);
  return [
    { key: 'now', label: '现在', at: null as Date | null },
    ...(evening > now ? [{ key: 'evening', label: '今天 18:00', at: evening }] : []),
    { key: 'morning', label: '明天 9:00', at: morning },
  ];
}

/**
 * 标为待处理 in the chat header: a line to remind yourself and when the customer should appear in 待处理. Once set,
 * a strip under the header shows it until someone presses 处理完.
 */
export function TodoMarkButton({ customerId, mark, timezone, onChanged }: { customerId: string; mark: Mark; timezone: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return <div className="bos-chat-mark-anchor">
    <button type="button" className={`bos-chat-mark-button${mark ? ' is-marked' : ''}`} aria-expanded={open} aria-label={mark ? '已标待处理，改提醒' : '标为待处理'} onClick={() => setOpen(v => !v)}>
      <Flag size={15} aria-hidden="true" /><span>{mark ? '已标待处理' : '标为待处理'}</span>
    </button>
    {open && <TodoMarkForm customerId={customerId} mark={mark} timezone={timezone} onClose={() => setOpen(false)} onChanged={onChanged} />}
  </div>;
}

function TodoMarkForm({ customerId, mark, timezone, onClose, onChanged }: { customerId: string; mark: Mark; timezone: string; onClose: () => void; onChanged: () => void }) {
  const options = choices(timezone);
  const [note, setNote] = useState(mark?.note ?? ''), [choice, setChoice] = useState(mark ? 'custom' : 'now');
  const [custom, setCustom] = useState(mark ? new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(mark.dueAt)).replace(' ', 'T') : '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // The button that opened the form toggles it itself; any other click outside closes it.
    const close = (e: MouseEvent) => { const anchor = box.current?.parentElement; if (anchor && !anchor.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const at = choice === 'custom' ? (custom ? localDate(custom, timezone) : null) : options.find(o => o.key === choice)?.at ?? null;
      await api('inbox/todo-mark', 'POST', { customerId, note: note.trim(), dueAt: at ? at.toISOString() : null });
      onChanged(); onClose();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form ref={box} className="bos-chat-popover bos-chat-mark-form" aria-label="标为待处理" onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    <strong>{mark ? '改提醒' : '标为待处理'}</strong>
    <label>提醒自己一句（可选）<input autoFocus value={note} maxLength={200} onChange={e => setNote(e.target.value)} placeholder="比如：今天发正式报价" /></label>
    <span className="bos-chat-mark-when">什么时候出现在待处理</span>
    <div className="bos-chat-stage-chips" role="radiogroup" aria-label="提醒时间">
      {options.map(o => <button key={o.key} type="button" role="radio" aria-checked={choice === o.key} onClick={() => setChoice(o.key)}>{o.label}</button>)}
      <button type="button" role="radio" aria-checked={choice === 'custom'} onClick={() => setChoice('custom')}>选时间…</button>
    </div>
    {choice === 'custom' && <label><span className="bos-chat-sr">提醒时间</span><input type="datetime-local" required value={custom} onChange={e => setCustom(e.target.value)} /></label>}
    {error && <p className="bos-chat-error" role="alert">{error}</p>}
    <div className="bos-chat-actions"><button type="submit" className="is-primary" disabled={busy}>{busy ? '保存中…' : mark ? '保存' : '标为待处理'}</button><button type="button" onClick={onClose}>取消</button></div>
  </form>;
}

/** The strip under the chat header while a customer is marked: when, the reminder, 改提醒 and 处理完. */
export function TodoMarkBanner({ customerId, mark, timezone, onChanged }: { customerId: string; mark: NonNullable<Mark>; timezone: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const due = new Date(mark.dueAt) > new Date();
  async function done() {
    setBusy(true); setError('');
    try { await api('inbox/todo-mark', 'DELETE', { customerId }); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="bos-chat-mark-banner" role="status">
    <Flag size={15} aria-hidden="true" />
    <span>待处理{due ? `（${formatDateTime(mark.dueAt, timezone)} 起出现）` : ''} · {mark.note || '已标记，处理好了点「处理完」'}</span>
    <div className="bos-chat-mark-anchor">
      <button type="button" onClick={() => setEditing(v => !v)} aria-expanded={editing}>改提醒</button>
      {editing && <TodoMarkForm customerId={customerId} mark={mark} timezone={timezone} onClose={() => setEditing(false)} onChanged={onChanged} />}
    </div>
    <button type="button" className="is-primary" onClick={done} disabled={busy}>{busy ? '…' : '处理完'}</button>
    {error && <p className="bos-chat-error" role="alert">{error}</p>}
  </div>;
}
