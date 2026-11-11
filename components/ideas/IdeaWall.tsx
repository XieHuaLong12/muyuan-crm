'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Archive, Check, ImagePlus, Link2, Loader2, Pencil, Pin, Search, Sparkles, X } from 'lucide-react';
import { Header } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { IDEA_STATUSES, NOTE_COLORS, NOTE_KINDS, STATUS_ORDER, guessKind, nextStatus, type NoteKind } from '@/lib/idea-wall';
import type { Wall, WallNoteView } from '@/services/idea-wall-service';

type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
type Data = Json<Wall>;
type Note = Json<WallNoteView>;
const KIND_KEYS = Object.keys(NOTE_KINDS) as NoteKind[];
const kindLabel = (k: string) => NOTE_KINDS[k as NoteKind] ? `${NOTE_KINDS[k as NoteKind][0]} ${NOTE_KINDS[k as NoteKind][1]}` : k;
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toISOString().slice(0, 10); };
const ago = (iso: string) => { const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000); return days <= 0 ? '今天' : days === 1 ? '昨天' : `${days} 天前`; };

/**
 * 想法墙 (docs/IDEA_WALL.md): my own wall. Paste a thought, a line I like, a tip, a link or a screenshot; the kind is
 * guessed and can be switched. Ideas move 刚想到 → 想做 → 在做 → 做完了 (a click on their chip); useful lines can be
 * saved as quick replies, screenshots into product materials. Nothing here is seen by anyone else.
 */
export function IdeaWall({ initial, admin }: { initial: Data; admin: boolean }) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState(''), [kind, setKind] = useState(''), [tag, setTag] = useState(''), [archived, setArchived] = useState(false);
  const [view, setView] = useState<'wall' | 'progress'>('wall');
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(tag ? { tag } : {}), ...(archived ? { archived: '1' } : {}) });
    try { const next = await api<Data>(`ideas?${params}`); if (n === seq.current) setData(next); } catch (e) { setError((e as Error).message); }
  }, [q, kind, tag, archived]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  async function run(what: string, call: () => Promise<unknown>) {
    setBusy(what); setError('');
    try { await call(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const patch = (id: string, body: object) => run(`p-${id}`, () => api(`ideas/${id}`, 'PATCH', body));
  const selected = data.notes.find(n => n.id === sel) ?? null;
  const tips = data.tidy.filter(t => !skipped.includes(JSON.stringify(t)));
  const ideas = data.notes.filter(n => n.kind === 'IDEA');

  return (
    <div className="iw-page">
      <Header title="想法墙" description="想法、喜欢的一段话、对工作有用的东西，先贴上来 · 只有你自己看得到"
        actions={<label className="iw-search"><Search size={15} aria-hidden /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜墙上的字、出处、标签" aria-label="搜索想法墙" /></label>} />
      {error && <p className="bos-sales-error" role="alert">{error}</p>}
      <Capture onSaved={(id) => { setSel(id); setKind(''); setTag(''); setArchived(false); void load(); }} onError={setError} />

      <div className="iw-toolbar">
        <span className="iw-seg" role="group" aria-label="怎么看">
          <button type="button" aria-pressed={view === 'wall'} onClick={() => setView('wall')}>墙</button>
          <button type="button" aria-pressed={view === 'progress'} onClick={() => setView('progress')}>按进度</button>
        </span>
        {[['', '全部', data.counts.all], ...KIND_KEYS.map(k => [k, kindLabel(k), data.counts[k]])].map(([k, label, n]) => (
          <button key={String(k) || 'all'} type="button" className="iw-chip" aria-pressed={kind === k} onClick={() => setKind(String(k))}>{label} {n}</button>
        ))}
        <span className="iw-tags">{data.tags.slice(0, 10).map(t => <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? '' : t)}>#{t}</button>)}</span>
        <button type="button" className="iw-chip is-quiet" aria-pressed={archived} onClick={() => { setArchived(!archived); setSel(null); }}><Archive size={13} aria-hidden />{archived ? '回到墙上' : '收起来的'}</button>
      </div>

      <div className="iw-main">
        <section className="iw-board" aria-label={archived ? '收起来的纸条' : '墙'}>
          {view === 'wall' || archived ? (
            data.notes.length ? <div className="iw-masonry">{data.notes.map((n, i) => <NoteCard key={n.id} n={n} i={i} on={sel === n.id} pick={() => setSel(sel === n.id ? null : n.id)}
              cycle={() => void patch(n.id, { status: nextStatus(n.status) })} />)}</div>
              : <p className="iw-empty">{archived ? '没有收起来的纸条。' : q || kind || tag ? '没有找到，换个词试试。' : '墙上还空着。上面写一句，或者把一段话、一个链接、一张截图粘贴进去。'}</p>
          ) : (
            <div className="iw-lanes">{STATUS_ORDER.map(st => { const list = ideas.filter(n => n.status === st); return (
              <div key={st} className="iw-lane"><span className="iw-lane-head"><b>{IDEA_STATUSES[st]}</b><small>{list.length}</small></span>
                {list.map((n, i) => <NoteCard key={n.id} n={n} i={i} on={sel === n.id} pick={() => setSel(sel === n.id ? null : n.id)} cycle={() => void patch(n.id, { status: nextStatus(n.status) })} />)}
              </div>); })}
              <p className="iw-lane-note">按进度只看「想法」；喜欢的话和有用的东西不分进度，在「墙」里看。</p>
            </div>
          )}
        </section>

        <aside className="iw-side">
          {data.quote && <section className="iw-quote">
            <span className="iw-quote-head"><b>今日一句</b>{!data.quote.fromSign && <Link href="/workbench">去求今天的签 →</Link>}</span>
            <p>「{data.quote.text}」</p><small>—— {data.quote.source}</small>
          </section>}
          {!!data.due.length && <section className="iw-due"><b>今天到日子的纸条</b>{data.due.map(d => <button key={d.id} type="button" onClick={() => setSel(d.id)}>{d.text}</button>)}</section>}
          {selected ? <Detail key={selected.id} n={selected} admin={admin} busy={busy} close={() => setSel(null)} patch={b => patch(selected.id, b)}
            task={() => run('task', () => api(`ideas/${selected.id}/task`, 'POST'))} save={target => run('save', () => api(`ideas/${selected.id}/save`, 'POST', { target }))} />
            : <section className="iw-hint">点墙上任意一张纸条：想法可以往下挪、转成任务、设日子提醒；喜欢的话可以复制；有用的可以存成常用回复。</section>}
          {!archived && <section className="iw-tidy">
            <span className="iw-tidy-head"><Sparkles size={15} aria-hidden /><b>帮你理一理</b></span>
            {tips.length ? tips.map(t => { const key = JSON.stringify(t);
              const act = t.kind === 'MERGE' ? () => patch(t.drop, { archived: true }) : t.kind === 'STALE' ? () => patch(t.id, { status: 'WANT' }) : () => run('save', () => api(`ideas/${t.id}/save`, 'POST', { target: 'QUICK_REPLY' }));
              return <div key={key} className="iw-tip"><p>{t.text}</p><span>
                <button type="button" onClick={() => setSkipped([...skipped, key])}>不用</button>
                {t.kind === 'STALE' && <button type="button" onClick={() => void patch(t.id, { archived: true })}>收起来</button>}
                <button type="button" className="is-primary" disabled={!!busy} onClick={() => void act()}>{t.kind === 'MERGE' ? '合并' : t.kind === 'STALE' ? '挪到想做' : '存成常用回复'}</button></span></div>; })
              : <p className="iw-muted">现在没有要整理的 👍</p>}
          </section>}
        </aside>
      </div>
    </div>
  );
}

function NoteCard({ n, i, on, pick, cycle }: { n: Note; i: number; on: boolean; pick: () => void; cycle: () => void }) {
  return (
    <article className={`iw-note is-${n.kind.toLowerCase()} is-${n.color}${on ? ' is-on' : ''}${n.status === 'DONE' ? ' is-done' : ''}`} style={{ ['--tilt' as string]: `${[-1.4, 1, -0.6, 1.6, -1, 0.7][i % 6]}deg` }}>
      <button type="button" className="iw-note-hit" onClick={pick} aria-label={`打开：${n.text.slice(0, 40)}`} aria-pressed={on} />
      <span className={`iw-pin${n.pinned ? ' is-pinned' : ''}`} aria-hidden />
      <span className="iw-note-top"><small>{kindLabel(n.kind)}</small>
        {n.kind === 'IDEA' && <button type="button" className={`iw-status is-${n.status.toLowerCase()}`} onClick={cycle} title="点一下换到下一步">{IDEA_STATUSES[n.status as keyof typeof IDEA_STATUSES] ?? n.status} ›</button>}</span>
      {/* A private screenshot behind the session: next/image cannot optimise it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {n.hasImage && <img className="iw-note-img" src={`/api/ideas/${n.id}/image`} alt={n.text || '截图'} loading="lazy" />}
      {n.linkUrl && <span className="iw-link"><Link2 size={13} aria-hidden />{(() => { try { return new URL(n.linkUrl).host; } catch { return n.linkUrl; } })()}</span>}
      <p className="iw-note-text">{n.kind === 'QUOTE' ? `「${n.text}」` : n.text}</p>
      {n.kind === 'QUOTE' && n.source && <small className="iw-source">—— {n.source}</small>}
      <span className="iw-note-foot">
        {n.tags.map(t => <em key={t}>#{t}</em>)}
        {n.taskId && <b className="is-task">已转任务</b>}
        {n.remindOn && n.status !== 'DONE' && <b className="is-remind">{n.remindOn.slice(5, 10).replace('-', '/')} 提醒</b>}
        {n.savedTo && <b className="is-saved">{n.savedTo === 'QUICK_REPLY' ? '已存成常用回复' : '已放进产品资料'}</b>}
        <i>{ago(n.createdAt)}{n.capturedOn ? ` · ${n.capturedOn}` : ''}</i>
      </span>
    </article>
  );
}

function Detail({ n, admin, busy, close, patch, task, save }: {
  n: Note; admin: boolean; busy: string; close: () => void; patch: (b: object) => Promise<void>; task: () => Promise<void>; save: (t: 'QUICK_REPLY' | 'MATERIAL') => Promise<void>;
}) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(n.text), [source, setSource] = useState(n.source);
  const [remind, setRemind] = useState(n.remindOn ? n.remindOn.slice(0, 10) : nextMonday()), [copied, setCopied] = useState(false);
  const archive = <button type="button" onClick={() => void patch({ archived: !n.archivedAt }).then(close)}>{n.archivedAt ? '放回墙上' : '收起来（存档）'}</button>;
  const pin = <button type="button" onClick={() => void patch({ pinned: !n.pinned })}><Pin size={13} aria-hidden />{n.pinned ? '取消置顶' : '置顶'}</button>;
  return (
    <section className={`iw-detail is-${n.kind.toLowerCase()} is-${n.color}`} aria-label="这张纸条">
      <span className="iw-detail-head"><b>{kindLabel(n.kind)}</b><button type="button" onClick={close} aria-label="关闭"><X size={16} /></button></span>
      {editing ? <form className="iw-edit" onSubmit={e => { e.preventDefault(); void patch({ text, ...(n.kind === 'QUOTE' ? { source } : {}) }).then(() => setEditing(false)); }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={2000} aria-label="内容" />
        {n.kind === 'QUOTE' && <input value={source} onChange={e => setSource(e.target.value)} placeholder="出处" maxLength={200} aria-label="出处" />}
        <span><button type="button" onClick={() => setEditing(false)}>取消</button><button type="submit" className="is-primary">保存</button></span>
      </form> : <>
        <p className={n.kind === 'QUOTE' ? 'iw-serif' : ''}>{n.kind === 'QUOTE' ? `「${n.text}」` : n.text}{n.kind === 'QUOTE' && n.source ? ` —— ${n.source}` : ''}</p>
        <small>{ago(n.createdAt)}{n.capturedOn ? ` · 在「${n.capturedOn}」记的` : ''}{n.tags.length ? ` · ${n.tags.map(t => `#${t}`).join(' ')}` : ''}</small>
      </>}
      {n.kind === 'IDEA' && <span className="iw-moves">{STATUS_ORDER.map(st => <button key={st} type="button" aria-pressed={n.status === st} onClick={() => void patch({ status: st })}>{IDEA_STATUSES[st]}</button>)}</span>}
      {n.kind === 'IDEA' && <span className="iw-colors">{NOTE_COLORS.map(c => <button key={c} type="button" className={`is-${c}`} aria-label={`换成${c}`} aria-pressed={n.color === c} onClick={() => void patch({ color: c })} />)}</span>}
      <div className="iw-actions">
        {n.kind === 'IDEA' && <>
          <button type="button" className="is-primary" disabled={!!n.taskId || busy === 'task'} onClick={() => void task()}>{busy === 'task' ? <Loader2 size={13} aria-hidden /> : <Check size={13} aria-hidden />}{n.taskId ? '已转成任务' : '转成任务（明天）'}</button>
          <span className="iw-remind"><input type="date" value={remind} onChange={e => setRemind(e.target.value)} aria-label="提醒日期" />
            <button type="button" onClick={() => void patch({ remindOn: n.remindOn ? null : remind })}>{n.remindOn ? '取消提醒' : '到这天提醒我'}</button></span>
        </>}
        {n.kind === 'QUOTE' && <button type="button" className="is-primary" onClick={() => { void navigator.clipboard?.writeText(`${n.text}${n.source ? ` —— ${n.source}` : ''}`).then(() => setCopied(true)); }}>{copied ? '✓ 已复制' : '复制这句话'}</button>}
        {n.kind === 'USEFUL' && <>
          <button type="button" className="is-primary" disabled={n.savedTo === 'QUICK_REPLY' || busy === 'save' || n.hasImage} onClick={() => void save('QUICK_REPLY')}>{n.savedTo === 'QUICK_REPLY' ? '✓ 已存成常用回复' : '存成常用回复'}</button>
          {n.hasImage && admin && <button type="button" disabled={n.savedTo === 'MATERIAL' || busy === 'save'} onClick={() => void save('MATERIAL')}>{n.savedTo === 'MATERIAL' ? '✓ 已放进产品资料' : '放进产品资料'}</button>}
          {n.linkUrl && <a href={n.linkUrl} target="_blank" rel="noreferrer noopener">打开链接 ↗</a>}
        </>}
        {pin}
        <button type="button" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden />编辑</button>
        {archive}
      </div>
      <small className="iw-muted">{n.kind === 'IDEA' ? '转成的任务在「任务」里；任务做完，这张自动变成「做完了」。' : n.kind === 'QUOTE' ? '喜欢的话会进「今日一句」，也是每日一签的赠言。' : '常用回复存成「我的」，回客户时打 / 就能用；截图放进产品资料要管理员。'}</small>
    </section>
  );
}

/** The capture bar: write, paste a link or a screenshot; the kind is guessed and can be switched. */
function Capture({ onSaved, onError }: { onSaved: (id: string) => void; onError: (m: string) => void }) {
  const [text, setText] = useState(''), [mode, setMode] = useState<'AUTO' | NoteKind>('AUTO'), [source, setSource] = useState('');
  const [color, setColor] = useState<(typeof NOTE_COLORS)[number]>('yellow'), [tags, setTags] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const guess = useMemo(() => guessKind(text), [text]);
  const kind: NoteKind = mode === 'AUTO' ? guess : mode;
  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try { const note = await api<{ id: string }>('ideas', 'POST', { text, kind: mode, source, color, tags, capturedOn: '想法墙' }); setText(''); setSource(''); setTags([]); onSaved(note.id); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  async function upload(f: File) {
    setBusy(true);
    try {
      const form = new FormData(); form.set('file', f); form.set('text', text); form.set('capturedOn', '想法墙');
      const res = await fetch('/api/ideas', { method: 'POST', body: form }); const body = await res.json();
      if (!body.success) throw new Error(body.error || '上传失败');
      setText(''); onSaved(body.data.id);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className={`iw-capture is-${kind.toLowerCase()} is-${color}`} aria-label="贴到墙上"
      onPaste={e => { const img = [...e.clipboardData.files].find(f => f.type.startsWith('image/')); if (img) { e.preventDefault(); void upload(img); } }}
      onDragOver={e => e.preventDefault()} onDrop={e => { const img = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (img) { e.preventDefault(); void upload(img); } }}>
      <div className="iw-capture-row">
        <span className="iw-capture-icon" aria-hidden>{NOTE_KINDS[kind][0]}</span>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={2000} placeholder="写一句、粘贴一段话、一个链接或一张截图……（回车贴上去，Shift+回车换行）"
          aria-label="写点什么贴到墙上" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
        <button type="button" className="iw-icon-btn" onClick={() => file.current?.click()} aria-label="贴一张截图" title="贴一张截图（也可以直接粘贴或拖进来）"><ImagePlus size={18} /></button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <button type="button" className="iw-submit" disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? <Loader2 size={15} aria-hidden /> : null}贴上去</button>
      </div>
      <div className="iw-capture-opts">
        <span className="iw-seg is-small" role="group" aria-label="贴成什么">
          {(['AUTO', ...KIND_KEYS] as const).map(k => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{k === 'AUTO' ? '自动' : kindLabel(k)}</button>)}
        </span>
        <small>{mode === 'AUTO' ? (text.trim() ? `看起来像「${NOTE_KINDS[guess][1]}」，不对就点左边换` : '自动判断：一段话、链接、截图，还是一个想法') : `贴成「${NOTE_KINDS[kind][1]}」`}</small>
        {kind === 'QUOTE' && <input className="iw-source-input" value={source} onChange={e => setSource(e.target.value)} placeholder="出处（可不填）：书名、人名或「自己写的」" maxLength={200} aria-label="出处" />}
        <span className="iw-capture-tags">{['广告', '客户', '产品', '系统', '心态', '话术'].map(t => <button key={t} type="button" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t])}>#{t}</button>)}</span>
        {kind === 'IDEA' && <span className="iw-colors">{NOTE_COLORS.map(c => <button key={c} type="button" className={`is-${c}`} aria-label={`纸条颜色 ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />)}</span>}
      </div>
    </section>
  );
}
