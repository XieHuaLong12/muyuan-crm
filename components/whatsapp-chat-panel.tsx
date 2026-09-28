'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Sparkles } from 'lucide-react';
import { api } from '@/lib/client';
import { stages } from '@/lib/constants';
import type { WhatsAppMessage } from '@/lib/types';

type ChatMessage = Pick<WhatsAppMessage, 'id' | 'content' | 'direction' | 'status' | 'sentAt' | 'messageType' | 'source' | 'attachmentMetadata'>;
type History = { messages: ChatMessage[]; nextCursor: string | null; stage: string; lastInboundAt: string | null; configured: boolean };
const statuses: Record<string, string> = { PENDING: '发送中', SENT: '已提交', ENQUEUED: '排队中', DELIVERED: '已送达', READ: '已读', FAILED: '发送失败', UNKNOWN: '结果未知', RECEIVED: '已接收' };
const merge = (old: ChatMessage[], incoming: ChatMessage[]) => Array.from(new Map([...old, ...incoming].map(m => [m.id, m])).values())
  .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));

export function WhatsappChatPanel({ customerId, customerName, stage, timezone, onStageChange }: {
  customerId: string; customerName: string; stage: string; timezone: string; onStageChange: (stage: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [history, setHistory] = useState<History>();
  const [cursor, setCursor] = useState<string | null>(null);
  const initialized = useRef(false);
  const request = useRef<{ id: string; content: string } | null>(null);
  const sendingLock = useRef(false);
  const stageCallback = useRef(onStageChange);
  stageCallback.current = onStageChange;
  const scrollBox = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/whatsapp/messages?customerId=${encodeURIComponent(customerId)}`, { signal, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '聊天记录加载失败');
    if (signal?.aborted) return;
    const data = result.data as History;
    setHistory(data); setMessages(old => merge(old, data.messages));
    if (!initialized.current) { setCursor(data.nextCursor); initialized.current = true; }
    stageCallback.current(data.stage); setSyncError(''); setLoading(false);
  }, [customerId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); }
      catch (e) { if (!controller.signal.aborted) { setSyncError((e as Error).message); setLoading(false); } }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => {
    if (nearBottom.current && scrollBox.current) scrollBox.current.scrollTop = scrollBox.current.scrollHeight;
  }, [messages]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!content.trim() || sendingLock.current) return;
    sendingLock.current = true; setSending(true); setError('');
    if (!request.current || request.current.content !== content.trim()) request.current = { id: crypto.randomUUID(), content: content.trim() };
    try {
      const result = await api<{ message: ChatMessage; error?: string }>('whatsapp/send', 'POST', {
        customerId, content: request.current.content, requestId: request.current.id,
      });
      setMessages(old => merge(old, [result.message])); nearBottom.current = true;
      if (['SENT', 'DELIVERED', 'READ'].includes(result.message.status)) { setContent(''); request.current = null; }
      if (result.message.status === 'FAILED') request.current = null;
      setError(result.error || (result.message.status === 'UNKNOWN' ? '发送结果未知，请先核对 WhatsApp。' : ''));
    } catch (e) { setError((e as Error).message); }
    finally { sendingLock.current = false; setSending(false); }
  }
  async function generate() {
    setGenerating(true); setError('');
    try { const result = await api<{ reply: string }>('whatsapp/ai-reply', 'POST', { customerId }); setDraft(result.reply); }
    catch (e) { setError((e as Error).message); }
    finally { setGenerating(false); }
  }
  async function loadMore() {
    if (!cursor) return;
    setMoreLoading(true);
    try {
      const data = await api<History>(`whatsapp/messages?customerId=${encodeURIComponent(customerId)}&before=${encodeURIComponent(cursor)}`);
      nearBottom.current = false; setMessages(old => merge(old, data.messages)); setCursor(data.nextCursor);
    } catch (e) { setError((e as Error).message); }
    finally { setMoreLoading(false); }
  }
  const windowOpen = !!history?.lastInboundAt && Date.now() - Date.parse(history.lastInboundAt) < 86400000;
  return <aside className="whatsapp-chat-panel card" aria-label="WhatsApp 工作台">
    <header className="whatsapp-chat-header">
      <span className="avatar large" aria-label={`${customerName} 的头像`}>{customerName.slice(0, 1)}</span>
      <div><strong>{customerName}</strong><div className="wa-brand"><MessageCircle size={14} /> WhatsApp</div>
        <small className="muted">在线状态未知 · {syncError ? '同步中断' : '每 5 秒同步'}</small></div>
      <span className="badge">{stages[(history?.stage || stage) as keyof typeof stages] || stage}</span>
    </header>
    {syncError && <p className="error" role="alert">{syncError}</p>}
    <div className="whatsapp-messages" role="log" aria-label="历史聊天记录" ref={scrollBox}
      onScroll={() => { const el = scrollBox.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {cursor && <button className="text-button" onClick={loadMore} disabled={moreLoading}>{moreLoading ? '加载中…' : '加载更早记录'}</button>}
      {loading && <p className="empty">正在加载聊天…</p>}
      {!loading && !messages.length && <p className="empty">暂无聊天记录，收到客户消息后会显示在这里。</p>}
      {messages.map(m => <div key={m.id} className={`wa-message ${m.direction === 'OUTBOUND' ? 'outbound' : 'inbound'}`}>
        <p>{m.content || (m.source === 'whatsapp_web' && m.attachmentMetadata && m.attachmentMetadata !== '[]' ? '［历史附件：仅保存元数据］' : '')}</p><small>{time(m.sentAt)}{m.source === 'whatsapp_web' && ' · Web 历史导入'}{m.direction === 'OUTBOUND' && ` · ${statuses[m.status.toUpperCase()] || m.status}`}</small>
      </div>)}
    </div>
    <section className="wa-ai-draft"><div className="card-title"><h3><Sparkles size={15} /> AI 回复建议</h3>
      <button className="text-button" onClick={generate} disabled={generating || !messages.length}>{generating ? '生成中…' : '生成建议'}</button></div>
      <textarea aria-label="AI 回复建议" rows={3} value={draft} onChange={e => setDraft(e.target.value)} placeholder="基于最近 20 条聊天生成家具外贸回复，审核后使用。" />
      <button className="text-button" disabled={!draft || sending} onClick={() => setContent(draft)}>使用此建议</button>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {!loading && <small className="muted">{!history?.configured ? '尚未配置 Gupshup 发送服务' : windowOpen ? '客户会话窗口有效' : '会话窗口关闭，请等待客户回复或发送已审核模板。'}</small>}
    <form className="whatsapp-input" onSubmit={send}>
      <textarea aria-label="WhatsApp 消息" rows={2} maxLength={4096} value={content} disabled={sending} onChange={e => setContent(e.target.value)} placeholder="输入 WhatsApp 消息…" />
      <button className="primary" type="submit" disabled={sending || !content.trim() || !history?.configured || !windowOpen}><Send size={16}/>{sending ? '发送中…' : '发送'}</button>
    </form>
  </aside>;
}
