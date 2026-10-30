'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search, Settings2, X } from 'lucide-react';
import { api } from '@/lib/client';
import { LIST_TAG_LIMIT, TAG_COLORS, TAG_COLOR_KEYS, TAG_NAME_MAX, tagStyle, type TagColor } from '@/lib/customer-tags';
import type { TagView } from './types';

type LibraryTag = TagView & { count: number };

export function TagPill({ tag, large = false, onRemove }: { tag: TagView; large?: boolean; onRemove?: () => void }) {
  return <span className={`bos-chat-label${large ? ' is-large' : ''}`} style={tagStyle(tag.color)} title={tag.name}>
    <span>{tag.name}</span>
    {onRemove && <button type="button" onClick={onRemove} aria-label={`去掉标签 ${tag.name}`}><X size={12} aria-hidden="true" /></button>}
  </span>;
}

/** Tags on a conversation row: the first two, then 「+n」. */
export function RowTags({ tags }: { tags: TagView[] }) {
  if (!tags.length) return null;
  const extra = tags.length - LIST_TAG_LIMIT;
  return <>{tags.slice(0, LIST_TAG_LIMIT).map(tag => <TagPill key={tag.id} tag={tag} />)}
    {extra > 0 && <span className="bos-chat-label is-more" title={tags.slice(LIST_TAG_LIMIT).map(t => t.name).join('、')}>+{extra}</span>}</>;
}

function Swatches({ value, onChange, label }: { value: TagColor; onChange: (color: TagColor) => void; label: string }) {
  return <div className="bos-chat-swatches" role="radiogroup" aria-label={label}>
    {TAG_COLOR_KEYS.map(key => <button key={key} type="button" role="radio" aria-checked={value === key} aria-label={`颜色：${TAG_COLORS[key].label}`}
      style={{ background: TAG_COLORS[key].dot, boxShadow: value === key ? `0 0 0 2px #fff, 0 0 0 4px ${TAG_COLORS[key].dot}` : undefined }} onClick={() => onChange(key)} />)}
  </div>;
}

function useLibrary() {
  const [tags, setTags] = useState<LibraryTag[] | null>(null), [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { setTags((await api<{ tags: LibraryTag[] }>('inbox/tags')).tags); setError(''); } catch (e) { setError((e as Error).message); }
  }, []);
  return { tags, error, reload };
}

/**
 * The profile's 标签 section: the customer's tags (× takes one off) and 「+ 标签」, which searches the shared library,
 * toggles a tag on or off, or creates a new one in one of eight colours.
 */
export function TagEditor({ customerId, tags, admin, onChanged }: { customerId: string; tags: TagView[]; admin: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [color, setColor] = useState<TagColor>('green');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [managing, setManaging] = useState(false);
  const library = useLibrary(), box = useRef<HTMLDivElement>(null);
  const { reload } = library;
  useEffect(() => { if (open) void reload(); }, [open, reload]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); onChanged(); void reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const on = new Set(tags.map(tag => tag.id));
  const name = query.trim();
  const shown = (library.tags ?? []).filter(tag => !name || tag.name.toLowerCase().includes(name.toLowerCase()));
  const exists = (library.tags ?? []).some(tag => tag.name === name);
  const toggle = (tag: TagView) => run(() => api('inbox/customer-tags', on.has(tag.id) ? 'DELETE' : 'POST', { customerId, tagId: tag.id }));
  const create = () => run(async () => { await api('inbox/customer-tags', 'POST', { customerId, name, color }); setQuery(''); });

  return <div className="bos-chat-tags">
    <div className="bos-chat-section-title"><span>标签</span>{admin && <button type="button" className="bos-chat-link" onClick={() => setManaging(true)}><Settings2 size={13} aria-hidden="true" />管理标签</button>}</div>
    <div className="bos-chat-tag-list" ref={box}>
      {tags.map(tag => <TagPill key={tag.id} tag={tag} large onRemove={() => run(() => api('inbox/customer-tags', 'DELETE', { customerId, tagId: tag.id }))} />)}
      <button type="button" className="bos-chat-add-tag" aria-expanded={open} onClick={() => setOpen(v => !v)}><Plus size={13} aria-hidden="true" />标签</button>
      {open && <div className="bos-chat-popover bos-chat-tag-picker" role="dialog" aria-label="添加标签" onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
        <label className="bos-chat-popover-search"><Search size={15} aria-hidden="true" /><span className="bos-chat-sr">搜索或新建标签</span>
          <input autoFocus value={query} maxLength={TAG_NAME_MAX} onChange={e => setQuery(e.target.value)} placeholder="搜索或新建标签"
            onKeyDown={e => { if (e.key === 'Enter' && name && !exists && !busy) { e.preventDefault(); void create(); } }} /></label>
        <div className="bos-chat-tag-options">
          {library.tags === null && !library.error && <p className="bos-chat-hint"><Loader2 size={13} aria-hidden="true" /> 正在加载标签…</p>}
          {shown.map(tag => <button key={tag.id} type="button" aria-pressed={on.has(tag.id)} disabled={busy} onClick={() => toggle(tag)}>
            <span className="bos-chat-check" aria-hidden="true">{on.has(tag.id) && <Check size={12} />}</span>
            <TagPill tag={tag} /><small>{tag.count} 位</small>
          </button>)}
          {library.tags !== null && !shown.length && !name && <p className="bos-chat-hint">还没有标签，输入名字新建一个。</p>}
        </div>
        {name && !exists && <div className="bos-chat-tag-new">
          <span>新建标签 <TagPill tag={{ id: 'new', name, color }} /></span>
          <Swatches value={color} onChange={setColor} label="新标签的颜色" />
          <div className="bos-chat-actions"><button type="button" className="is-primary" disabled={busy} onClick={create}>{busy ? '保存中…' : '新建并贴上'}</button></div>
        </div>}
        {(error || library.error) && <p className="bos-chat-error" role="alert">{error || library.error}</p>}
      </div>}
    </div>
    {!open && error && <p className="bos-chat-error" role="alert">{error}</p>}
    {managing && <TagManager onClose={() => setManaging(false)} onChanged={onChanged} />}
  </div>;
}

/** Administrators rename, recolour or delete shared tags; every customer carrying one changes with it. */
export function TagManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { tags, error: loadError, reload } = useLibrary();
  const [editing, setEditing] = useState<{ id: string; name: string; color: TagColor } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { void reload(); }, [reload]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); setEditing(null); await reload(); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="bos-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    <div>
      <header><div><h2 id="tag-manager-title">管理标签</h2><p>全公司共用一套标签。改名、换颜色后，所有贴了它的客户一起变；删除只是把标签从客户身上去掉。</p></div>
        <button type="button" className="bos-chat-icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button></header>
      <div className="bos-chat-tag-manager">
        {tags === null && !loadError && <p className="bos-chat-hint">正在加载…</p>}
        {tags?.length === 0 && <p className="bos-chat-hint">还没有标签。在客户资料里点「+ 标签」新建。</p>}
        {tags?.map(tag => editing?.id === tag.id ? <div key={tag.id} className="bos-chat-tag-row is-editing">
          <label><span className="bos-chat-sr">标签名</span><input autoFocus value={editing.name} maxLength={TAG_NAME_MAX} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
          <Swatches value={editing.color} onChange={next => setEditing({ ...editing, color: next })} label={`${tag.name} 的颜色`} />
          <div className="bos-chat-actions">
            <button type="button" className="is-primary" disabled={busy || !editing.name.trim()} onClick={() => run(() => api(`inbox/tags/${encodeURIComponent(tag.id)}`, 'PATCH', { name: editing.name.trim(), color: editing.color }))}>保存</button>
            <button type="button" onClick={() => setEditing(null)}>取消</button>
          </div>
        </div> : <div key={tag.id} className="bos-chat-tag-row">
          <TagPill tag={tag} large /><small>{tag.count} 位</small>
          <span className="bos-chat-tag-row-actions">
            <button type="button" onClick={() => setEditing({ id: tag.id, name: tag.name, color: (tag.color in TAG_COLORS ? tag.color : 'gray') as TagColor })}>改名 / 换色</button>
            <button type="button" className="is-danger" disabled={busy} onClick={() => { if (window.confirm(`删除标签「${tag.name}」？它会从 ${tag.count} 位客户身上去掉。`)) void run(() => api(`inbox/tags/${encodeURIComponent(tag.id)}`, 'DELETE')); }}>删除</button>
          </span>
        </div>)}
      </div>
      {(error || loadError) && <p className="bos-chat-error" role="alert">{error || loadError}</p>}
    </div>
  </div>;
}

/** The list's tag filter: every tag in the library, with how many of this person's customers carry it. */
export function TagFilter({ value, onChange }: { value: string; onChange: (tagId: string) => void }) {
  const { tags, reload } = useLibrary();
  useEffect(() => { void reload(); }, [reload]);
  return <select className="bos-chat-owner" value={value} onChange={e => onChange(e.target.value)} aria-label="按标签筛选" onFocus={() => void reload()}>
    <option value="">全部标签</option>
    {(tags ?? []).map(tag => <option key={tag.id} value={tag.id}>{tag.name}（{tag.count}）</option>)}
  </select>;
}
