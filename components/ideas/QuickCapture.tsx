'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Lightbulb, Loader2, X } from 'lucide-react';
import { api } from '@/lib/client';
import { NOTE_KINDS, guessKind, type NoteKind } from '@/lib/idea-wall';
import { activeWorkspace } from '@/lib/role-workspace';

/**
 * 随手贴 on every page: the 💡 in the corner (or the N key) opens a small note. Text selected on the page — a
 * customer's line in a chat, a number on a report — comes along. It remembers which page it was written on, and
 * goes onto 想法墙 (docs/IDEA_WALL.md). Nothing is shared with anyone.
 */
export function QuickCapture({ path, role }: { path: string; role: string }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [mode, setMode] = useState<'AUTO' | NoteKind>('AUTO');
  const [busy, setBusy] = useState(false), [done, setDone] = useState(''), [error, setError] = useState('');
  const picked = useRef('');
  const box = useRef<HTMLTextAreaElement>(null);

  const where = () => {
    const active = activeWorkspace(path, role);
    const country = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('country') : null;
    const name = active ? (active.tab && active.tab.label !== active.section.label ? `${active.section.label} · ${active.tab.label}` : active.section.label) : '';
    return [name, country].filter(Boolean).join(' · ').slice(0, 200);
  };
  const start = (selected: string) => {
    const seed = selected.trim().slice(0, 2000);
    setText(seed); setMode(seed ? 'USEFUL' : 'AUTO'); setDone(''); setError(''); setOpen(true);
    setTimeout(() => box.current?.focus(), 0);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]'))) return;
      e.preventDefault(); start(window.getSelection()?.toString() ?? '');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (!open) return; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [open]);

  async function save() {
    if (!text.trim()) return;
    setBusy(true); setError('');
    try { await api('ideas', 'POST', { text, kind: mode, capturedOn: where() }); setText(''); setDone('已贴到想法墙'); setTimeout(() => { setOpen(false); setDone(''); }, 1400); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (path.startsWith('/ideas')) return null;
  const kind: NoteKind = mode === 'AUTO' ? guessKind(text) : mode;
  return (
    <div className="qc">
      {open && <section className={`qc-note is-${kind.toLowerCase()}`} role="dialog" aria-label="随手贴到想法墙">
        <span className="qc-head"><small>{where() ? `在「${where()}」` : '随手贴'}</small><button type="button" onClick={() => setOpen(false)} aria-label="收起"><X size={15} /></button></span>
        <textarea ref={box} value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000} placeholder="现在想到什么？也可以先选中页面上的一段字再按 N"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} aria-label="写点什么" />
        <span className="qc-kinds" role="group" aria-label="贴成什么">
          {(['AUTO', 'IDEA', 'QUOTE', 'USEFUL'] as const).map(k => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{k === 'AUTO' ? '自动' : NOTE_KINDS[k][0] + ' ' + NOTE_KINDS[k][1]}</button>)}
        </span>
        <span className="qc-foot">
          {done ? <b className="qc-done">✓ {done} · <Link href="/ideas">去看看</Link></b> : error ? <b className="qc-error">{error}</b> : <small>Ctrl / ⌘ + 回车 贴上去 · Esc 收起</small>}
          <button type="button" className="qc-save" disabled={busy || !text.trim()} onClick={() => void save()}>{busy && <Loader2 size={13} aria-hidden />}贴上去</button>
        </span>
      </section>}
      <button type="button" className="qc-ball" aria-label="随手贴一个想法（快捷键 N）" title="随手贴（快捷键 N）· 先选中页面上的字也行" aria-expanded={open}
        onPointerDown={() => { picked.current = window.getSelection()?.toString() ?? ''; }}
        onClick={() => open ? setOpen(false) : start(picked.current)}>
        <Lightbulb size={22} aria-hidden />
      </button>
    </div>
  );
}
