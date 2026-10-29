'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, Minimize2, MessageCircle, PanelLeftClose, PanelLeftOpen, Plus, Search, UserRound, X } from 'lucide-react';
import { api } from '@/lib/client';
import { purchases, sources, stages } from '@/lib/constants';
import { ChatThread } from './ChatThread';
import { LegacyTag } from './OutreachPanel';
import { dueLabel, formatListTime, initial, toneOf, windowLeft, type Conversation, type Filter, type InboxList, type LinkCandidate, type PendingCustomer, type UnmatchedNumber } from './types';

const LIST_POLL_MS = 15_000;
const LIST_COLLAPSED_KEY = 'bos-chat-list-collapsed';
const FILTERS: { key: Filter; label: string }[] = [{ key: 'all', label: '全部' }, { key: 'unread', label: '未读' }, { key: 'awaiting', label: '待我回复' }, { key: 'pending', label: '待首联' }];

/** Later pages and refreshes add what is not shown yet, in both the conversation and the 待首联 lists. */
const mergePages = (current: InboxList, next: InboxList): InboxList => ({ ...next,
  conversations: [...current.conversations, ...next.conversations.filter(c => !current.conversations.some(m => m.id === c.id))],
  pending: [...current.pending, ...next.pending.filter(c => !current.pending.some(m => m.id === c.id))] });

function listUrl(filter: Filter, q: string, ownerId: string, page: number) {
  const params = new URLSearchParams({ filter, page: String(page) });
  if (q) params.set('q', q);
  if (ownerId) params.set('ownerId', ownerId);
  return `inbox/conversations?${params}`;
}

function ConversationItem({ item, active, admin, timezone, onOpen }: { item: Conversation; active: boolean; admin: boolean; timezone: string; onOpen: () => void }) {
  const left = item.window.status === 'OPEN' ? windowLeft(item.window.expiresAt) : null;
  const tag = item.firstContactOverdue ? <span className="bos-chat-tag is-danger">首联超时</span>
    : left && left.minutes < 120 ? <span className="bos-chat-tag is-warning">窗口剩 {Math.max(1, Math.round(left.minutes / 60))} 小时</span>
    : <span className={`bos-chat-tag${['QUOTED', 'WON', 'ORDER'].includes(item.stage) ? ' is-green' : ''}`}>{stages[item.stage as keyof typeof stages] ?? item.stage}</span>;
  const last = item.lastMessage, status = last?.status.toUpperCase();
  return <button type="button" className="bos-chat-conversation" aria-current={active ? 'true' : undefined} onClick={onOpen}>
    <span className={`bos-chat-avatar bos-chat-tone-${toneOf(item.id)}`} aria-hidden="true">{initial(item.name)}</span>
    <span className="bos-chat-conversation-body">
      <span className="bos-chat-row"><strong>{item.name}</strong><time className={item.unread ? 'is-unread' : undefined} dateTime={item.lastMessageAt}>{formatListTime(item.lastMessageAt, timezone)}</time></span>
      <span className="bos-chat-meta">{item.countryCode && <span className="bos-chat-code">{item.countryCode}</span>}<span>{item.companyName || item.country || '公司待补充'}</span>{tag}{item.legacy && <LegacyTag />}{admin && <span>· {item.owner.name}</span>}</span>
      <span className="bos-chat-row">
        <span className={`bos-chat-preview${item.unread ? ' is-unread' : ''}`}>
          {last?.direction === 'OUTBOUND' && (status === 'READ' ? <CheckCheck size={15} className="bos-chat-tick is-read" aria-label="已读" /> : status === 'DELIVERED' ? <CheckCheck size={15} className="bos-chat-tick" aria-label="已送达" /> : status === 'FAILED' ? <span className="bos-chat-tick is-failed">发送失败</span> : <Check size={15} className="bos-chat-tick" aria-label="已发送" />)}
          <span>{last?.direction === 'OUTBOUND' ? '我方：' : ''}{last?.preview || '—'}</span>
        </span>
        {!!item.unread && <b className="bos-chat-count" aria-label={`${item.unread} 条未读`}>{item.unread}</b>}
      </span>
    </span>
  </button>;
}

/** A customer assigned to someone who has not contacted them yet: the deadline, the ad form and (for administrators) the owner. */
function PendingItem({ item, active, admin, timezone, now, onOpen }: { item: PendingCustomer; active: boolean; admin: boolean; timezone: string; now: number; onOpen: () => void }) {
  const due = dueLabel(item.firstContactDueAt, now);
  const summary = [item.productInterest.replace(/_+/g, ' ').trim() || '产品未填写', (purchases as Record<string, string>)[item.purchaseType] && item.purchaseType !== 'OTHER' ? (purchases as Record<string, string>)[item.purchaseType] : '',
    item.quantity ? `首单 ${item.quantity} 件` : ''].filter(Boolean).join(' · ');
  return <button type="button" className="bos-chat-conversation" aria-current={active ? 'true' : undefined} onClick={onOpen}>
    <span className={`bos-chat-avatar bos-chat-tone-${toneOf(item.id)}`} aria-hidden="true">{initial(item.name)}</span>
    <span className="bos-chat-conversation-body">
      <span className="bos-chat-row"><strong>{item.name}</strong>{item.assignedAt && <time dateTime={item.assignedAt}>分配 {formatListTime(item.assignedAt, timezone)}</time>}</span>
      <span className="bos-chat-meta">
        {item.countryCode && <span className="bos-chat-code">{item.countryCode}</span>}
        <span className="bos-chat-tag">{(sources as Record<string, string>)[item.source] ?? item.source}</span>
        {item.leadGrade && <span className={`bos-chat-tag${item.leadGrade === 'A' ? ' is-green' : ''}`}>{item.leadGrade} 级</span>}
        {due && <span className={`bos-chat-tag${due.tone === 'danger' ? ' is-danger' : due.tone === 'warning' ? ' is-warning' : ''}`}>{due.text}</span>}
        {admin && <span>· {item.owner.name}</span>}
      </span>
      <span className="bos-chat-preview"><span>{summary}</span></span>
    </span>
  </button>;
}

/** Start a chat with any customer this person can see (new customers need a template first). */
function NewChatDialog({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState(''), [rows, setRows] = useState<{ id: string; name: string; companyName: string; country: string }[]>([]), [error, setError] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    const timer = setTimeout(() => api<{ rows: typeof rows }>(`customers?group=all&q=${encodeURIComponent(q.trim())}&pageSize=10`).then(r => { setRows(r.rows); setError(''); }).catch(e => setError((e as Error).message)), 300);
    return () => clearTimeout(timer);
  }, [q]);
  return <div className="bos-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="new-chat-title" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    <div>
      <header><div><h2 id="new-chat-title">发起新会话</h2><p>选择客户后打开聊天。客户还没联系过业务号时，需要先发送模板消息。</p></div><button type="button" className="bos-chat-icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button></header>
      <label className="bos-chat-search" style={{ margin: 0 }}><Search size={16} aria-hidden="true" /><span className="bos-chat-sr">搜索客户</span><input autoFocus type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="输入客户姓名、公司或电话" /></label>
      {error && <p className="bos-chat-error">{error}</p>}
      <div className="bos-chat-options">{rows.map(row => <button key={row.id} type="button" className="bos-chat-option" onClick={() => onPick(row.id)}>
        <span className={`bos-chat-avatar bos-chat-tone-${toneOf(row.id)}`} aria-hidden="true">{initial(row.name)}</span>
        <span><strong>{row.name}</strong>{[row.companyName, row.country].filter(Boolean).join(' · ') || '资料待补充'}</span></button>)}
        {q.trim().length >= 2 && !rows.length && !error && <p className="bos-chat-hint" style={{ display: 'block' }}>没有找到匹配的客户</p>}
      </div>
    </div>
  </div>;
}

/** Administrators link a number the system could not tie to exactly one customer. */
function LinkDialog({ number, onClose, onLinked }: { number: UnmatchedNumber; onClose: () => void; onLinked: (customerId: string) => void }) {
  const [q, setQ] = useState(''), [candidates, setCandidates] = useState<LinkCandidate[]>([]), [chosen, setChosen] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => api<{ candidates: LinkCandidate[] }>(`inbox/link?key=${encodeURIComponent(number.key)}&q=${encodeURIComponent(q.trim())}`)
      .then(r => { setCandidates(r.candidates); setError(''); }).catch(e => setError((e as Error).message)), q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [number.key, q]);
  async function link() {
    setBusy(true);
    try { await api('inbox/link', 'POST', { key: number.key, customerId: chosen }); onLinked(chosen); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="bos-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="link-title" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    <div>
      <header><div><h2 id="link-title">把这个号码关联到客户</h2><p>{number.peerPhone || '号码无效'}{number.peerName ? ` · ${number.peerName}` : ''} · {number.count} 条消息 · 最近：“{number.lastMessage.slice(0, 60)}”</p></div><button type="button" className="bos-chat-icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button></header>
      <div className="bos-chat-options" role="radiogroup" aria-label="选择要关联的客户">
        {candidates.map(c => <button key={c.id} type="button" className="bos-chat-option" aria-pressed={chosen === c.id} onClick={() => setChosen(c.id)}>
          <span className={`bos-chat-avatar bos-chat-tone-${toneOf(c.id)}`} aria-hidden="true">{initial(c.name)}</span>
          <span><strong>{c.name}</strong>{[c.companyName, c.country, `负责人 ${c.owner.name}`].filter(Boolean).join(' · ')}</span>
          {c.samePhone && <span className="bos-chat-tag is-green" style={{ flex: 'none' }}>号码一致</span>}
        </button>)}
        {!candidates.length && <p className="bos-chat-hint" style={{ display: 'block' }}>没有号码相同的客户，可以按姓名或公司搜索。</p>}
      </div>
      <label className="bos-chat-search" style={{ margin: 0 }}><Search size={15} aria-hidden="true" /><span className="bos-chat-sr">搜索其他客户</span><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="都不对？搜索其他客户" /></label>
      {error && <p className="bos-chat-error" role="alert">{error}</p>}
      <div className="bos-chat-actions" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose}>取消</button>
        <button type="button" className="is-primary" disabled={!chosen || busy} onClick={link}>{busy ? '关联中…' : '确认关联'}</button>
      </div>
      <p className="bos-chat-hint" style={{ display: 'block' }}>关联后，这个号码的历史消息会归入客户档案，以后的消息自动匹配。</p>
    </div>
  </div>;
}

export function MessageCenter({ initialList, initialCustomerId, timezone, admin }: { initialList: InboxList; initialCustomerId: string | null; timezone: string; admin: boolean }) {
  const [list, setList] = useState(initialList);
  const [filter, setFilter] = useState<Filter>(initialList.query.filter);
  const [q, setQ] = useState(initialList.query.q);
  const [ownerId, setOwnerId] = useState(initialList.query.ownerId);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(initialCustomerId);
  const [profileOpen, setProfileOpen] = useState(true);
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'link'; number: UnmatchedNumber } | null>(null);
  // Full-screen chat: the message center fills the window and the workspace frame steps aside.
  const [fullscreen, setFullscreen] = useState(false);
  // The list folds into a column of avatars to give the chat more room; remembered per browser. Phones never fold it.
  const [listCollapsed, setListCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const firstLoad = useRef(true);

  useEffect(() => {
    try { setListCollapsed(localStorage.getItem(LIST_COLLAPSED_KEY) === '1'); } catch { /* storage unavailable: start expanded */ }
    const phone = window.matchMedia('(max-width: 760px)');
    const update = () => setNarrow(phone.matches);
    update(); phone.addEventListener('change', update);
    return () => phone.removeEventListener('change', update);
  }, []);
  function toggleList() {
    const next = !listCollapsed;
    setListCollapsed(next);
    try { localStorage.setItem(LIST_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* storage unavailable: not remembered */ }
  }
  const collapsed = listCollapsed && !narrow;

  // Narrow screens open the profile as an overlay on demand instead of as a third column.
  useEffect(() => { if (window.matchMedia('(max-width: 1400px)').matches) setProfileOpen(false); }, []);

  const refresh = useCallback(async (pages = page) => {
    try {
      const first = await api<InboxList>(listUrl(filter, q.trim(), ownerId, 1));
      let merged = first;
      // Keep the pages already shown (load more) while refreshing.
      for (let p = 2; p <= pages && merged.hasMore; p++) merged = mergePages(merged, await api<InboxList>(listUrl(filter, q.trim(), ownerId, p)));
      setList(merged); setError(''); setNow(Date.now());
    } catch (e) { setError((e as Error).message); }
  }, [filter, q, ownerId, page]);

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    const timer = setTimeout(() => { setPage(1); void refresh(1); }, 250);
    return () => clearTimeout(timer);
    // Only a change of filter, search or owner reloads from the first page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, q, ownerId]);

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!fullscreen) return;
    const exit = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', exit);
    return () => document.removeEventListener('keydown', exit);
  }, [fullscreen]);

  function open(id: string | null) {
    setSelected(id);
    window.history.replaceState(null, '', id ? `/messages?customer=${encodeURIComponent(id)}` : '/messages');
  }
  // After a greeting goes out from 待首联 the customer leaves the list (first contact is recorded): open the next one.
  function sentFromPending(id: string) {
    const order = list.pending.map(p => p.id), at = order.indexOf(id);
    const next = at >= 0 ? order[at + 1] ?? order[at - 1] ?? null : null;
    setNotice(`已发送给 ${list.pending[at]?.name ?? '客户'}，记为首次联系。${next ? '已打开下一位。' : ''}`);
    open(next);
  }
  const markRead = useCallback((id: string) => setList(current => ({ ...current, conversations: current.conversations.map(c => c.id === id ? { ...c, unread: 0 } : c) })), []);
  const changed = useCallback(() => { void refresh(); }, [refresh]);

  const [retry, setRetry] = useState<{ busy: boolean; note: string }>({ busy: false, note: '' });
  async function retryNumbers() {
    setRetry({ busy: true, note: '' });
    try {
      const r = await api<{ createdCustomers: number; imported: number; remaining: number }>('inbox/retry', 'POST', {});
      setRetry({ busy: false, note: `新建客户 ${r.createdCustomers} 位，归入会话 ${r.imported} 条${r.remaining ? `，还有 ${r.remaining} 条需要人工选择客户` : ''}` });
      await refresh(1);
    } catch (e) { setRetry({ busy: false, note: (e as Error).message }); }
  }

  async function more() {
    try {
      const next = await api<InboxList>(listUrl(filter, q.trim(), ownerId, page + 1));
      setList(current => mergePages(current, next));
      setPage(page + 1);
    } catch (e) { setError((e as Error).message); }
  }

  const unreadTotal = list.conversations.filter(c => c.unread).length;
  const pendingHint = admin ? '所有销售名下已分配、还没联系过的客户，最急的在最上面。' : '分配给你、还没联系过的客户，最急的在最上面。点开直接发首条模板，发出后自动移出。';
  return <div className="bos-messages-page">
    <div className={`bos-chat${selected ? ' is-thread-open' : ''}${selected && profileOpen ? ' is-profile-open' : ' is-profile-closed'}${fullscreen ? ' is-fullscreen' : ''}${collapsed ? ' is-list-collapsed' : ''}`}>
      {collapsed ? <section className="bos-chat-list is-collapsed" aria-label="会话列表（已收起）">
        <button type="button" className="bos-chat-icon-button" onClick={toggleList} aria-label="展开会话列表" title="展开会话列表"><PanelLeftOpen size={18} /></button>
        <button type="button" className="bos-chat-icon-button is-primary" onClick={() => setDialog({ kind: 'new' })} aria-label="发起新会话" title="发起新会话"><Plus size={18} /></button>
        <div className="bos-chat-rail">
          {(filter === 'pending' ? list.pending.map(p => ({ id: p.id, name: p.name, badge: dueLabel(p.firstContactDueAt, now)?.tone === 'danger' ? '首联超时' : '', count: 0 }))
            : filter === 'unmatched' ? [] : list.conversations.map(c => ({ id: c.id, name: c.name, badge: '', count: c.unread }))).map(item =>
            <button key={item.id} type="button" className="bos-chat-rail-item" aria-current={selected === item.id ? 'true' : undefined} onClick={() => { setNotice(''); open(item.id); }}
              title={item.name} aria-label={[item.name, item.badge, item.count ? `${item.count} 条未读` : ''].filter(Boolean).join('，')}>
              <span className={`bos-chat-avatar bos-chat-tone-${toneOf(item.id)}`} aria-hidden="true">{initial(item.name)}</span>
              {item.count > 0 ? <b className="bos-chat-rail-count" aria-hidden="true">{item.count}</b> : item.badge && <b className="bos-chat-rail-dot" aria-hidden="true" />}
            </button>)}
        </div>
      </section>
      : <section className="bos-chat-list" aria-label="会话列表">
        <header className="bos-chat-list-head"><h1>消息</h1><div>
          {!narrow && <button type="button" className="bos-chat-icon-button" onClick={toggleList} aria-label="收起会话列表" title="收起会话列表"><PanelLeftClose size={18} /></button>}
          <button type="button" className="bos-chat-icon-button is-primary" onClick={() => setDialog({ kind: 'new' })} aria-label="发起新会话"><Plus size={18} /></button>
        </div></header>
        <label className="bos-chat-search"><Search size={16} aria-hidden="true" /><span className="bos-chat-sr">搜索会话</span><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索客户、公司、国家或电话" /></label>
        {admin && <select className="bos-chat-owner" value={ownerId} onChange={e => setOwnerId(e.target.value)} aria-label="按负责人筛选">
          <option value="">全部负责人</option><option value="mine">我负责的客户</option>
          {list.sales.map(s => <option key={s.id} value={s.id}>{s.name}{s.role === 'ADMIN' ? '（管理员）' : ''}</option>)}
        </select>}
        <div className="bos-chat-filters" role="group" aria-label="会话分类">
          {FILTERS.map(f => <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setNotice(''); }}>{f.label}{f.key === 'unread' && filter !== 'unread' && unreadTotal ? ` ${unreadTotal}` : ''}{f.key === 'pending' && list.pendingTotal ? ` ${list.pendingTotal}` : ''}</button>)}
          {admin && (list.unmatchedTotal > 0 || filter === 'unmatched') && <button type="button" aria-pressed={filter === 'unmatched'} onClick={() => setFilter('unmatched')}>未关联 {list.unmatchedTotal}</button>}
        </div>
        {filter === 'pending' && <p className="bos-chat-list-hint" role="status">{notice || pendingHint}</p>}
        <div className="bos-chat-conversations">
          {error && <p className="bos-chat-error" role="alert" style={{ padding: '0 16px' }}>{error}</p>}
          {filter === 'unmatched' && !!list.numbers.length && <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f3ef' }}>
            <div className="bos-chat-actions"><button type="button" className="is-primary" onClick={retryNumbers} disabled={retry.busy}>{retry.busy ? '匹配中…' : '重新匹配'}</button></div>
            <p className="bos-chat-hint" style={{ display: 'block' }}>{retry.note || '按号码重新查找客户：找不到的新建客户，只对应一位客户的直接归入，对应多位客户的需要点开选择。'}</p>
          </div>}
          {filter === 'unmatched' ? list.numbers.map(n => <button key={n.key} type="button" className="bos-chat-conversation" onClick={() => setDialog({ kind: 'link', number: n })}>
            <span className="bos-chat-avatar is-unknown" aria-hidden="true"><UserRound size={18} /></span>
            <span className="bos-chat-conversation-body">
              <span className="bos-chat-row"><strong>{n.peerPhone || n.peerName || '号码无效'}</strong><time>{formatListTime(n.lastMessageAt, timezone)}</time></span>
              <span className="bos-chat-meta"><span className="bos-chat-tag is-warning">{n.reason === 'AMBIGUOUS' ? '号码有冲突' : n.reason === 'INVALID_PHONE' ? '号码无效' : '未关联客户'}</span><span>{n.count} 条 · 点击关联</span></span>
              <span className="bos-chat-preview"><span>{n.lastMessage}</span></span>
            </span>
          </button>)
            : filter === 'pending' ? list.pending.map(item => <PendingItem key={item.id} item={item} admin={admin} timezone={timezone} now={now} active={selected === item.id} onOpen={() => { setNotice(''); open(item.id); }} />)
            : list.conversations.map(item => <ConversationItem key={item.id} item={item} admin={admin} timezone={timezone} active={selected === item.id} onOpen={() => open(item.id)} />)}
          {filter === 'pending' && !list.pending.length && <div className="bos-chat-list-empty"><strong>{q ? '没有找到匹配的客户' : '待首联的客户都联系过了'}</strong>{q ? '换个关键词试试。' : admin ? '分配后还没联系的客户会出现在这里。' : '新分配给你的客户会出现在这里。'}</div>}
          {filter !== 'unmatched' && filter !== 'pending' && !list.conversations.length && <div className="bos-chat-list-empty"><strong>{q ? '没有找到匹配的会话' : filter === 'unread' ? '没有未读消息' : filter === 'awaiting' ? '没有等待回复的客户' : '还没有 WhatsApp 会话'}</strong>{q ? '换个关键词试试。' : '客户通过公司业务号发来消息后，会出现在这里。'}</div>}
          {filter === 'unmatched' && !list.numbers.length && <div className="bos-chat-list-empty"><strong>没有待关联的号码</strong>新号码会自动建档；只有号码对应多位客户或号码无效时才需要人工关联。</div>}
          {list.hasMore && filter !== 'unmatched' && <button type="button" className="bos-chat-more" onClick={more}>{filter === 'pending' ? '加载更多客户' : '加载更多会话'}</button>}
        </div>
      </section>}

      {selected ? <ChatThread key={selected} customerId={selected} timezone={timezone} profileOpen={profileOpen} onToggleProfile={() => setProfileOpen(v => !v)} onBack={() => open(null)} onChanged={changed} onRead={markRead}
        fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen(v => !v)}
        autoTemplate={filter === 'pending'} onTemplateSent={filter === 'pending' && list.pending.some(p => p.id === selected) ? () => sentFromPending(selected) : undefined} />
        : <section className="bos-chat-thread"><div className="bos-chat-empty-thread"><div><MessageCircle size={34} aria-hidden="true" color="#174b3b" /><strong>选择一个会话开始聊天</strong>客户发来的文字、图片、语音、视频和文件都会显示在这里，<br />回复通过公司 WhatsApp 业务号发出并自动记入客户档案。
          {fullscreen && <div className="bos-chat-actions" style={{ justifyContent: 'center', marginTop: 14 }}><button type="button" onClick={() => setFullscreen(false)}><Minimize2 size={14} aria-hidden="true" />退出全屏</button></div>}</div></div></section>}

      {dialog?.kind === 'new' && <NewChatDialog onClose={() => setDialog(null)} onPick={id => { setDialog(null); open(id); }} />}
      {dialog?.kind === 'link' && <LinkDialog number={dialog.number} onClose={() => setDialog(null)} onLinked={id => { setDialog(null); setFilter('all'); open(id); }} />}
    </div>
  </div>;
}
