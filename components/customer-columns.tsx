'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronDown, GripVertical, Lock, Search, X } from 'lucide-react';
import { api } from '@/lib/client';
import {
  CUSTOMER_COLUMN_GROUPS, CUSTOMER_COLUMN_KEYS, CUSTOMER_COLUMNS, DEFAULT_CUSTOMER_COLUMNS, isLockedColumn, sameColumns,
  type CustomerColumnGroup, type CustomerColumnKey,
} from '@/lib/customer-columns';
import { Dialog } from './ui/dialog';

export type CustomerColumnView = { columns: CustomerColumnKey[]; custom: boolean };

const label = (key: CustomerColumnKey) => CUSTOMER_COLUMNS[key].label;

/**
 * 「定制列」: pick the list's columns by group on the left, drag them into order on the right. Saved per user, so each
 * salesperson sees the columns that fit how they follow up; nobody else's list changes.
 */
export function ColumnPicker({ value, onClose, onSaved }: {
  value: readonly CustomerColumnKey[]; onClose: () => void; onSaved: (view: CustomerColumnView) => void;
}) {
  const [order, setOrder] = useState<CustomerColumnKey[]>([...value]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<CustomerColumnGroup | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<CustomerColumnGroup>>(new Set());
  const [dragging, setDragging] = useState<CustomerColumnKey>();
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const stopDrag = useRef<() => void>(undefined);
  useEffect(() => () => stopDrag.current?.(), []);

  const chosen = new Set(order);
  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => CUSTOMER_COLUMN_GROUPS
    .filter(g => tab === 'all' || g.key === tab)
    .map(g => ({ ...g, all: CUSTOMER_COLUMN_KEYS.filter(key => CUSTOMER_COLUMNS[key].group === g.key) }))
    .map(g => ({ ...g, shown: needle ? g.all.filter(key => label(key).toLowerCase().includes(needle)) : g.all }))
    .filter(g => g.shown.length), [tab, needle]);

  const toggle = (key: CustomerColumnKey, on: boolean) => setOrder(prev => on ? [...prev.filter(k => k !== key), key] : prev.filter(k => k !== key));
  const firstMovable = order.filter(isLockedColumn).length;
  const moveTo = (key: CustomerColumnKey, index: number) => setOrder(prev => {
    const rest = prev.filter(k => k !== key);
    const at = Math.min(Math.max(index, firstMovable), rest.length);
    const next = [...rest.slice(0, at), key, ...rest.slice(at)];
    return sameColumns(next, prev) ? prev : next;
  });

  // Pointer drag for mouse, pen and touch alike. The listeners sit on window because React may move the dragged
  // item's node while reordering, which would drop a pointer capture held by its handle.
  const startDrag = (key: CustomerColumnKey) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stopDrag.current?.();
    setDragging(key);
    const move = (ev: globalThis.PointerEvent) => {
      if (!listRef.current) return;
      const others = [...listRef.current.querySelectorAll<HTMLElement>('[data-column]')].filter(el => el.dataset.column !== key);
      const index = others.findIndex(el => { const r = el.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      moveTo(key, index === -1 ? others.length : index);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      stopDrag.current = undefined;
      setDragging(undefined);
      setAnnouncement(`「${label(key)}」在第 ${orderRef.current.indexOf(key) + 1} 列`);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    stopDrag.current = end;
  };
  const keyMove = (key: CustomerColumnKey) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = Math.min(Math.max(order.indexOf(key) + step, firstMovable), order.length - 1);
    moveTo(key, index);
    setAnnouncement(`「${label(key)}」移到第 ${index + 1} 列`);
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      // Choosing exactly the default columns clears the personal setting, so later default changes reach this user too.
      const view = sameColumns(order, DEFAULT_CUSTOMER_COLUMNS)
        ? await api<CustomerColumnView>('customer-columns', 'DELETE')
        : await api<CustomerColumnView>('customer-columns', 'PUT', { columns: order });
      onSaved(view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title="定制列" className="column-picker">
      <p className="column-picker-intro">只改变你自己看到的客户列表，不影响其他同事。</p>
      <div className="column-picker-body">
        <div className="column-picker-options">
          <label className="column-picker-search">
            <Search size={16} aria-hidden />
            <input type="search" placeholder="搜索列名" aria-label="搜索列名" value={query} onChange={e => setQuery(e.target.value)} />
          </label>
          <div className="column-picker-tabs" role="tablist" aria-label="列分组">
            {[{ key: 'all' as const, label: '全部' }, ...CUSTOMER_COLUMN_GROUPS].map(g => (
              <button key={g.key} type="button" role="tab" aria-selected={tab === g.key} className={tab === g.key ? 'active' : ''} onClick={() => setTab(g.key)}>{g.label}</button>
            ))}
          </div>
          <div className="column-picker-groups">
            {groups.map(g => {
              const open = !!needle || !collapsed.has(g.key);
              const count = g.all.filter(key => chosen.has(key)).length;
              return (
                <section key={g.key} className="column-picker-group">
                  <button type="button" className="column-picker-group-head" aria-expanded={open} disabled={!!needle}
                    onClick={() => setCollapsed(prev => { const next = new Set(prev); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}>
                    <span><strong>{g.label}</strong><small>已选 {count} 项</small></span>
                    <ChevronDown size={18} aria-hidden className={open ? 'is-open' : ''} />
                  </button>
                  {open && (
                    <div className="column-picker-checks">
                      {g.shown.map(key => (
                        <label key={key} className="column-picker-check">
                          <input type="checkbox" checked={chosen.has(key)} disabled={isLockedColumn(key)} onChange={e => toggle(key, e.target.checked)} />
                          <span>{label(key)}{isLockedColumn(key) && <small>固定显示</small>}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            {!groups.length && <p className="column-picker-empty">没有找到「{query.trim()}」相关的列</p>}
          </div>
        </div>
        <div className="column-picker-chosen">
          <div className="column-picker-chosen-head">
            <strong>已选择 {order.length} 列</strong>
            <small>拖放即可重新排序。</small>
          </div>
          <ol ref={listRef} className={dragging ? 'is-sorting' : undefined}>
            {order.map(key => (
              <li key={key} data-column={key} className={dragging === key ? 'is-dragging' : undefined}>
                {isLockedColumn(key) ? (
                  <span className="column-picker-handle is-locked" title="客户列固定在第一列"><Lock size={14} aria-hidden /></span>
                ) : (
                  <button type="button" className="column-picker-handle" aria-label={`调整「${label(key)}」的位置：拖动，或按上下方向键`}
                    onPointerDown={startDrag(key)} onKeyDown={keyMove(key)}>
                    <GripVertical size={16} aria-hidden />
                  </button>
                )}
                <span className="column-picker-label">{label(key)}</span>
                {!isLockedColumn(key) && (
                  <button type="button" className="column-picker-remove" aria-label={`移除「${label(key)}」`} onClick={() => toggle(key, false)}><X size={16} aria-hidden /></button>
                )}
              </li>
            ))}
          </ol>
          <span className="visually-hidden" aria-live="polite">{announcement}</span>
        </div>
      </div>
      <div className="column-picker-foot">
        <button type="button" className="text-button" disabled={busy || sameColumns(order, DEFAULT_CUSTOMER_COLUMNS)} onClick={() => setOrder([...DEFAULT_CUSTOMER_COLUMNS])}>恢复默认列</button>
        {error && <p role="alert" className="error">{error}</p>}
        <div>
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </Dialog>
  );
}
