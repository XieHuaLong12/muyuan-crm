'use client';
import { forwardRef, useEffect, useImperativeHandle, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { Search, Star, X } from 'lucide-react';
import { api } from '@/lib/client';
import { QUICK_REPLY_CATEGORIES, REPLY_LANGUAGES, fillVariables, matchesReply, replyFor, type ReplyBodies } from '@/lib/quick-replies';

type Reply = { id: string; scope: 'SHARED' | 'MINE'; title: string; category: string; zh: string; bodies: ReplyBodies; top: boolean };
type List = { replies: Reply[]; customer: { language: string; firstName: string } | null; me: string };
/** What goes into the input box: the customer's language (variables filled) and the Chinese it means. */
export type FilledReply = { text: string; zh: string; language: string; missing: boolean };
export type QuickRepliesHandle = { key: (e: KeyboardEvent<HTMLElement>) => boolean };
const LANGUAGE_LABELS: Record<string, string> = { ...REPLY_LANGUAGES, zh: '中文' };

/** The variables as they will be sent, marked so the salesperson sees what was filled in. */
function Preview({ text, values }: { text: string; values: { customer: string; me: string } }) {
  return <>{text.split(/(\{客户名\}|\{我的名字\})/).map((part, i) => part === '{客户名}' || part === '{我的名字}'
    ? <mark key={i}>{(part === '{客户名}' ? values.customer : values.me) || part}</mark> : part)}</>;
}

/**
 * 常用回复 above the composer, opened by its chip or by typing "/" in the input (then the input is the search).
 * A click, or ↑↓ and Enter, fills the input box in the customer's language — it is never sent from here.
 */
export const QuickRepliesPanel = forwardRef<QuickRepliesHandle, {
  customerId: string; query: string | null; canChat: boolean; onPick: (reply: FilledReply) => void; onClose: () => void;
}>(function QuickRepliesPanel({ customerId, query, canChat, onPick, onClose }, ref) {
  const [list, setList] = useState<List>();
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'SHARED' | 'MINE'>('SHARED');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    api<List>(`quick-replies?customerId=${encodeURIComponent(customerId)}`).then(r => { setList(r); setError(''); }).catch(e => setError((e as Error).message));
  }, [customerId]);

  // Typing after "/" searches every reply, whichever tab is open.
  const words = query ?? search;
  const shown = (list?.replies ?? []).filter(r => (query !== null || r.scope === scope) && (!category || r.category === category) && (!words.trim() || matchesReply(r, words)));
  useEffect(() => setActive(0), [query, search, scope, category]);
  const language = list?.customer?.language ?? 'en';
  const values = { customer: list?.customer?.firstName ?? '', me: list?.me ?? '' };

  function pick(reply: Reply) {
    if (!canChat) return;
    const chosen = replyFor(reply, language);
    onPick({ text: fillVariables(chosen.text, values), zh: fillVariables(reply.zh, values), language: chosen.language, missing: chosen.missing });
    void api(`quick-replies/${reply.id}/use`, 'POST').catch(() => undefined);
  }
  /** ↑↓ move, Enter fills, Esc closes. Enter never falls through to sending, even before the list has loaded. */
  function key(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') { onClose(); return true; }
    if (e.key === 'Enter' && !e.shiftKey) { if (shown.length) pick(shown[Math.min(active, shown.length - 1)]); return true; }
    if (!shown.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return false;
    setActive(a => e.key === 'ArrowDown' ? (a + 1) % shown.length : (a - 1 + shown.length) % shown.length);
    return true;
  }
  useImperativeHandle(ref, () => ({ key }));

  return <div className="bos-chat-panel bos-chat-replies" role="dialog" aria-label="常用回复">
    <div className="bos-chat-panel-head">
      <strong>常用回复</strong>
      <small>{query !== null ? `搜「${query || '…'}」· ` : ''}↑↓ 选择 · 回车填入 · Esc 关闭</small>
      <span style={{ flex: 1 }} />
      {query === null && <div className="bos-chat-segments" role="tablist" aria-label="回复范围">
        {(['SHARED', 'MINE'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={scope === key} onClick={() => setScope(key)}>{key === 'SHARED' ? '公司共用' : '我的'}</button>)}
      </div>}
      <button type="button" className="bos-chat-icon-button" onClick={onClose} aria-label="关闭常用回复"><X size={16} /></button>
    </div>
    {query === null && <label className="bos-chat-panel-search"><Search size={14} aria-hidden="true" /><span className="bos-chat-sr">搜常用回复</span>
      <input type="search" value={search} autoFocus onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (key(e)) e.preventDefault(); }} placeholder="搜标题或中文，比如 交期；也可以在输入框打 / 直接搜" /></label>}
    <div className="bos-chat-reply-cats" role="tablist" aria-label="分类">
      {[['', '全部'], ...Object.entries(QUICK_REPLY_CATEGORIES)].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={category === key} onClick={() => setCategory(key)}>{label}</button>)}
    </div>
    {!canChat && <p className="bos-chat-panel-note">客户超过 24 小时没回复时只能发模板消息，常用回复暂时不能用。</p>}
    <div className="bos-chat-panel-body" role="listbox" aria-label="回复">
      {!list && !error && <p className="bos-chat-hint" style={{ display: 'block' }}>正在加载…</p>}
      {shown.map((reply, i) => {
        const chosen = replyFor(reply, language);
        return <button key={reply.id} type="button" role="option" aria-selected={i === active} className="bos-chat-reply" disabled={!canChat} onClick={() => pick(reply)} onMouseEnter={() => setActive(i)}>
          <span className="bos-chat-reply-head"><strong>{reply.title}</strong><em>{QUICK_REPLY_CATEGORIES[reply.category as keyof typeof QUICK_REPLY_CATEGORIES] ?? reply.category}</em>
            {reply.top && <em className="is-top"><Star size={10} aria-hidden="true" />最常用</em>}
            {query !== null && <em>{reply.scope === 'SHARED' ? '公司共用' : '我的'}</em>}
            {i === active && canChat && <small>回车填入 ↵</small>}</span>
          <span className="bos-chat-reply-text"><Preview text={chosen.text} values={values} /></span>
          {chosen.language !== 'zh' && <span className="bos-chat-reply-zh">中文：<Preview text={reply.zh} values={values} /></span>}
          {chosen.missing && <span className="bos-chat-reply-missing">还没有{LANGUAGE_LABELS[language] ?? '客户语言'}版，{chosen.language === 'zh' ? '填入的是中文，可以点「译成客户语言」' : `填入的是${LANGUAGE_LABELS[chosen.language]}版`}</span>}
        </button>;
      })}
      {list && !shown.length && <p className="bos-chat-panel-empty">{words.trim() || category ? '没有匹配的回复。' : scope === 'MINE' ? '还没有自己的常用回复。' : '还没有公司共用的回复。'}点下面「新建回复」添加。</p>}
    </div>
    {error && <p className="bos-chat-error" role="alert">{error}</p>}
    <p className="bos-chat-panel-tip"><Link href="/messages/replies?new=1">＋ 新建回复</Link> · <Link href="/messages/replies">管理常用回复</Link> · 常用回复里不放价格，价格请用报价单</p>
  </div>;
});
