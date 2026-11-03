'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, MessageSquareText, CheckCheck, CircleAlert, Clock3, FileText, Languages, LayoutTemplate, Loader2, Maximize2, Minimize2, PanelRight, Paperclip, RefreshCw, Send, Sparkles, Undo2, Wand2, X } from 'lucide-react';
import { api } from '@/lib/client';
import { TRANSLATE_BATCH, needsTranslation } from '@/lib/message-translation';
import { REPLY_LANGUAGES } from '@/lib/quick-replies';
import { FIRST_TOUCH_PRODUCT_LINES, purchases, sources, stages } from '@/lib/constants';
import { formatDateTime, formatDay, formatTime, requestId, windowLeft, type ChatMessage, type TemplateList, type Thread, type Translation } from './types';
import { LegacyTag, OutreachBar, OutreachProfile, useOutreach } from './OutreachPanel';
import { StageControl } from './StageControl';
import { DemandCard } from './DemandCard';
import { GradeAvatar, GradeControl, GradeFollow } from './Grade';
import { ComposerHandle, useComposerSize } from './Composer';
import { MaterialsPanel } from './Materials';
import { PolishPanel } from './Polish';
import { QuickRepliesPanel, type QuickRepliesHandle } from './QuickReplies';
import { TagEditor } from './Tags';
import { TodoMarkBanner, TodoMarkButton } from './TodoMark';

const POLL_MS = 8_000;
const TRANSLATING = '翻译中…';
const MEDIA_TYPES = new Set(['IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'DOCUMENT', 'FILE', 'STICKER']);
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,audio/mpeg,audio/ogg,audio/mp4,audio/aac,audio/amr,application/pdf,text/plain,application/zip,.docx,.xlsx';
const label = (map: Record<string, string>, key: string | null | undefined) => (key && map[key]) || key || '—';

/** Placeholder bodies such as "[IMAGE]" or the file name are not shown when the file itself is displayed; without a file they are all there is. */
function visibleText(message: ChatMessage) {
  const text = message.content.trim();
  if (!MEDIA_TYPES.has(message.messageType.toUpperCase()) || !(message.mediaHref || message.attachmentMetadata)) return message.content;
  if (/^\[[^\]]*\]$/.test(text) || (message.fileName && (text === message.fileName || text === `[文件] ${message.fileName}`))) return '';
  return message.content;
}

function Status({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === 'PENDING') return <Clock3 size={14} className="bos-chat-tick" role="img" aria-label="发送中" />;
  if (s === 'ENQUEUED' || s === 'SENT') return <Check size={15} className="bos-chat-tick" role="img" aria-label="已发送" />;
  if (s === 'DELIVERED') return <CheckCheck size={15} className="bos-chat-tick" role="img" aria-label="已送达" />;
  if (s === 'READ') return <CheckCheck size={15} className="bos-chat-tick is-read" role="img" aria-label="已读" />;
  if (s === 'FAILED') return <span className="is-error">发送失败</span>;
  if (s === 'UNKNOWN') return <span className="is-error">结果未知，请核对后再发</span>;
  return null;
}

function Media({ message, broken, onBroken, onLoad }: { message: ChatMessage; broken: boolean; onBroken: () => void; onLoad: () => void }) {
  const type = message.messageType.toUpperCase(), mime = message.mimeType || '';
  if (!message.mediaHref) {
    if (!message.attachmentMetadata) return null;
    let files: { fileName?: string; kind?: string }[] = [];
    try { files = JSON.parse(message.attachmentMetadata); } catch { return null; }
    return Array.isArray(files) ? <>{files.map((file, index) => <span key={index} className="bos-chat-media-missing">{file.fileName || file.kind || '历史附件'} · 仅留存文件信息</span>)}</> : null;
  }
  if (broken) return <span className="bos-chat-media-missing">文件已过期或无法下载，请在手机 WhatsApp 中查看</span>;
  const href = message.mediaHref;
  if (type === 'IMAGE' || type === 'STICKER' || (/^image\/(jpeg|png|webp|gif)/.test(mime) && !['DOCUMENT', 'FILE'].includes(type)))
    // Authenticated media from our own API: next/image would proxy it without the session cookie.
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={href} target="_blank" rel="noreferrer"><img className="bos-chat-media" src={href} alt={message.fileName || '图片'} loading="lazy" onError={onBroken} onLoad={onLoad} /></a>;
  if (type === 'VIDEO' || mime.startsWith('video/')) return <video className="bos-chat-media" src={href} controls preload="metadata" onError={onBroken} onLoadedMetadata={onLoad} />;
  if (type === 'AUDIO' || type === 'VOICE' || mime.startsWith('audio/'))
    return <><audio className="bos-chat-media" src={href} controls preload="none" onError={onBroken} /><a className="bos-chat-link" href={href} download>下载语音</a></>;
  const ext = (message.fileName?.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
  return <a className="bos-chat-file" href={href} target="_blank" rel="noreferrer"><b>{ext}</b><span><strong>{message.fileName || '文件'}</strong><small>{mime || '文件'} · 点击查看</small></span></a>;
}

function mergeMessages(current: ChatMessage[], latest: ChatMessage[]) {
  if (!current.length || !latest.length) return latest;
  const ids = new Set(latest.map(m => m.id)), oldest = latest[0].sentAt;
  // Keep older pages the person already loaded; the newest page replaces everything it covers.
  return [...current.filter(m => !ids.has(m.id) && m.sentAt < oldest), ...latest];
}

export function ChatThread({ customerId, timezone, admin, profileOpen, onToggleProfile, onBack, onChanged, onRead, fullscreen, onToggleFullscreen, autoTemplate = false, onTemplateSent }: {
  customerId: string; timezone: string; admin: boolean; profileOpen: boolean; onToggleProfile: () => void; onBack: () => void; onChanged: () => void; onRead: (customerId: string) => void;
  fullscreen: boolean; onToggleFullscreen: () => void;
  /** Opened from 待首联: show the suggested greeting as soon as the thread loads, if only a template can go out. */
  autoTemplate?: boolean; onTemplateSent?: () => void;
}) {
  const [thread, setThread] = useState<Thread>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<{ id: string; fileName: string; mimeType: string }>();
  const [busy, setBusy] = useState<'' | 'send' | 'upload' | 'draft' | 'older' | 'template' | 'translate' | 'summary'>('');
  const [sendError, setSendError] = useState('');
  // The panel open above the composer: 产品资料 or 常用回复.
  const [panel, setPanel] = useState<'' | 'materials' | 'replies' | 'polish'>('');
  // Typing "/" first in the input searches 常用回复; Esc hides the list until the "/" is gone.
  const [slashClosed, setSlashClosed] = useState(false);
  const replies = useRef<QuickRepliesHandle>(null);
  const [draft, setDraft] = useState<{ reply: string; replyZh?: string; nextStep?: string; warnings: string[]; quoteHref?: string | null }>();
  // The Chinese the salesperson typed before "译成客户语言", so the translation can be undone.
  // What goes back into the input on 还原, and the Chinese kept with the message: after 译成客户语言 both are what
  // the salesperson typed; after 优化话术 `text` is their own line and `zh` the chosen version's Chinese.
  const [original, setOriginal] = useState<{ text: string; language: string; zh?: string; label?: string }>();
  // Chinese lines: what the automatic translation brought this visit, and what a click on 翻译 brought (or its status).
  const [autoTranslated, setAutoTranslated] = useState<Record<string, Translation>>({});
  const [translations, setTranslations] = useState<Record<string, Translation | string>>({});
  const [autoSwitch, setAutoSwitch] = useState<boolean | null>(null);
  const [autoDown, setAutoDown] = useState(false);
  const asked = useRef(new Set<string>());
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<TemplateList & { open: boolean; chosen: string; params: string[]; error: string }>({ status: 'CONNECTED', templates: [], suggestion: null, fills: {}, open: false, chosen: '', params: [], error: '' });
  const { outreach, reloadOutreach } = useOutreach(customerId);
  const box = useRef<HTMLElement>(null);
  const composer = useComposerSize(text, box);
  const log = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null), stickToBottom = useRef(true), lastSeen = useRef(''), autoOpened = useRef(false);

  const load = useCallback(async (quiet = false) => {
    try {
      const data = await api<Thread>(`inbox/thread?customerId=${encodeURIComponent(customerId)}`);
      const el = log.current;
      stickToBottom.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setThread(data); setMessages(current => mergeMessages(current, data.messages)); setError('');
      if (!quiet) setCursor(data.nextCursor);
      const newest = data.messages.at(-1);
      if (newest && newest.id !== lastSeen.current && !document.hidden) {
        lastSeen.current = newest.id;
        await api('whatsapp/read', 'POST', { customerId, readAt: new Date().toISOString() }).catch(() => undefined);
        onRead(customerId);
      }
    } catch (e) { if (!quiet) setError((e as Error).message); }
  }, [customerId, onRead]);

  useEffect(() => {
    setThread(undefined); setMessages([]); setCursor(null); setText(''); setAttachment(undefined); setDraft(undefined); setSendError(''); setTranslations({});
    setAutoTranslated({}); setAutoSwitch(null); setAutoDown(false); asked.current = new Set(); setPanel('');
    setTemplates(t => ({ ...t, open: false, chosen: '', params: [], error: '' })); lastSeen.current = ''; stickToBottom.current = true;
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(true); }, POLL_MS);
    return () => clearInterval(timer);
  }, [customerId, load]);

  // Photos, players and late fonts grow the log after rendering; stay on the newest message unless the person scrolled up.
  const keepAtBottom = useCallback(() => { if (stickToBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight; }, []);
  useEffect(keepAtBottom, [messages, keepAtBottom]);
  useEffect(() => {
    if (!content.current || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(keepAtBottom);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [keepAtBottom]);

  async function older() {
    if (!cursor) return;
    setBusy('older');
    try {
      const page = await api<Thread>(`inbox/thread?customerId=${encodeURIComponent(customerId)}&before=${encodeURIComponent(cursor)}`);
      const el = log.current, before = el?.scrollHeight ?? 0;
      stickToBottom.current = false;
      setMessages(current => { const ids = new Set(current.map(m => m.id)); return [...page.messages.filter(m => !ids.has(m.id)), ...current]; });
      setCursor(page.nextCursor);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  async function send() {
    if (!thread || busy || (!text.trim() && !attachment)) return;
    setBusy('send'); setSendError('');
    try {
      const result = await api<{ error?: string }>('whatsapp/send', 'POST', { customerId, content: text.trim(), requestId: requestId(), ...(attachment ? { mediaAssetId: attachment.id } : {}),
        ...(original ? { original: original.zh ?? original.text } : {}) });
      if (result.error) setSendError(result.error); else { setText(''); setAttachment(undefined); setDraft(undefined); setOriginal(undefined); composer.setBig(false); }
      stickToBottom.current = true; await load(true); onChanged(); void reloadOutreach();
    } catch (e) { setSendError((e as Error).message); } finally { setBusy(''); }
  }

  async function upload(chosen: File | undefined) {
    if (!chosen) return;
    setBusy('upload'); setSendError('');
    try {
      const form = new FormData(); form.set('customerId', customerId); form.set('file', chosen);
      const response = await fetch('/api/whatsapp/media', { method: 'POST', body: form });
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '上传失败');
      setAttachment({ id: body.data.id, fileName: body.data.fileName, mimeType: body.data.mimeType });
    } catch (e) { setSendError((e as Error).message); } finally { setBusy(''); if (file.current) file.current.value = ''; }
  }

  /** previous: the draft on screen, when the salesperson asks for a different version of it. */
  async function aiDraft(previous?: string) {
    setBusy('draft'); setSendError('');
    try { setDraft(await api<{ reply: string; replyZh: string; nextStep: string; warnings: string[]; quoteHref: string | null }>('whatsapp/ai-reply', 'POST', { customerId, previous })); }
    catch (e) { setSendError((e as Error).message); } finally { setBusy(''); }
  }

  async function translateOut() {
    if (!text.trim()) return;
    setBusy('translate'); setSendError('');
    try {
      const r = await api<{ text: string; language: string }>('inbox/translate-out', 'POST', { customerId, text });
      setOriginal({ text, language: r.language }); setText(r.text);
    } catch (e) { setSendError((e as Error).message); } finally { setBusy(''); }
  }

  async function refreshSummary() {
    setBusy('summary'); setSendError('');
    try { await api(`customers/${encodeURIComponent(customerId)}/analyze`, 'POST'); await load(true); }
    catch (e) { setSendError((e as Error).message); } finally { setBusy(''); }
  }

  async function translate(id: string) {
    setTranslations(t => ({ ...t, [id]: TRANSLATING }));
    try { const r = await api<Translation>('inbox/translate', 'POST', { messageId: id }); setTranslations(t => ({ ...t, [id]: r })); }
    catch (e) { setTranslations(t => ({ ...t, [id]: (e as Error).message })); }
  }

  // 自动翻译: the newest foreign messages without Chinese yet, a few at a time; stored, so each is translated once.
  const autoOn = autoSwitch ?? thread?.customer.autoTranslate ?? false;
  useEffect(() => {
    if (!thread || !autoOn || autoDown) return;
    const ids = messages.filter(m => !m.translation && !autoTranslated[m.id] && !asked.current.has(m.id) && needsTranslation(m)).slice(-TRANSLATE_BATCH).map(m => m.id);
    if (!ids.length) return;
    ids.forEach(id => asked.current.add(id));
    api<{ translations: Record<string, Translation>; unavailable: boolean }>('inbox/translate-batch', 'POST', { customerId, messageIds: ids })
      .then(r => { setAutoTranslated(t => ({ ...t, ...r.translations })); if (r.unavailable) setAutoDown(true); })
      .catch(() => setAutoDown(true));
  }, [thread, messages, autoOn, autoDown, autoTranslated, customerId]);
  async function toggleAuto() {
    const next = !autoOn;
    setAutoSwitch(next); setAutoDown(false);
    try { await api('inbox/auto-translate', 'PATCH', { customerId, on: next }); }
    catch (e) { setAutoSwitch(!next); setSendError((e as Error).message); }
  }

  /** Every template comes filled in from the customer record; what the record does not say stays empty. */
  const paramsFor = (list: TemplateList, id: string) => list.fills[id]?.map(f => f.value) ?? Array(list.templates.find(t => t.id === id)?.variables ?? 0).fill('');
  const openTemplates = useCallback(async () => {
    setTemplates(t => ({ ...t, open: true, error: '' }));
    try {
      const r = await api<TemplateList>(`whatsapp/templates?customerId=${encodeURIComponent(customerId)}`);
      const chosen = r.suggestion?.templateId ?? r.templates[0]?.id ?? '';
      setTemplates(t => ({ ...t, ...r, chosen, params: paramsFor(r, chosen) }));
    } catch (e) { setTemplates(t => ({ ...t, error: (e as Error).message })); }
  }, [customerId]);

  useEffect(() => {
    if (!autoTemplate || !thread || autoOpened.current) return;
    autoOpened.current = true;
    if (thread.sending.configured && thread.sending.templates && !thread.sending.optedOut && thread.window.status !== 'OPEN') void openTemplates();
  }, [autoTemplate, thread, openTemplates]);

  async function sendTemplate() {
    const template = templates.templates.find(t => t.id === templates.chosen);
    if (!template) return;
    setBusy('template'); setTemplates(t => ({ ...t, error: '' }));
    try {
      const r = await api<{ error?: string }>('whatsapp/templates', 'POST', { customerId, templateId: template.id, params: templates.params.map(p => p.trim()), requestId: requestId() });
      if (r.error) setTemplates(t => ({ ...t, error: r.error! })); else setTemplates(t => ({ ...t, open: false }));
      stickToBottom.current = true; await load(true); onChanged(); void reloadOutreach();
      if (!r.error) onTemplateSent?.();
    } catch (e) { setTemplates(t => ({ ...t, error: (e as Error).message })); } finally { setBusy(''); }
  }

  const customer = thread?.customer;
  const win = thread?.window, left = win?.status === 'OPEN' ? windowLeft(win.expiresAt) : null;
  // The newest customer message: the demand profile reads the chat again after it.
  const lastInboundAt = messages.reduce<string | null>((latest, m) => m.direction === 'INBOUND' && (!latest || m.sentAt > latest) ? m.sentAt : latest, null);
  const canChat = !!thread?.sending.configured && !thread.sending.optedOut && win?.status === 'OPEN';
  const chosenTemplate = templates.templates.find(t => t.id === templates.chosen);
  const fills = chosenTemplate ? templates.fills[chosenTemplate.id] ?? [] : [];
  // Filled values are marked in the preview; an empty variable shows its {{n}} so it is easy to spot.
  const preview = chosenTemplate ? chosenTemplate.body.split(/(\{\{\s*\d{1,2}\s*\}\})/).map(part => {
    const n = /^\{\{\s*(\d{1,2})\s*\}\}$/.exec(part)?.[1];
    return n ? { text: templates.params[Number(n) - 1]?.trim() || part, variable: true, empty: !templates.params[Number(n) - 1]?.trim() } : { text: part, variable: false, empty: false };
  }) : [];
  const emptyIn = (id: string) => (id === templates.chosen ? templates.params : paramsFor(templates, id)).filter(p => !p.trim()).length;
  // Which profile facts the chosen template uses, shown next to them while the template panel is open.
  const usedBy = templates.open ? fills.reduce<Record<string, string[]>>((all, fill, i) => fill.source ? { ...all, [fill.source]: [...(all[fill.source] ?? []), `{{${i + 1}}}`] } : all, {}) : {};
  const used = (source: string) => usedBy[source] ? <span className="bos-chat-used">{usedBy[source].join(' ')}</span> : null;
  // Stage, tags and the 待处理 mark change what the list shows too.
  const profileChanged = () => { void load(true); onChanged(); };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const slash = canChat && /^\/[^\n]{0,40}$/.test(text) ? text.slice(1) : null;
  const repliesOpen = panel === 'replies' || (slash !== null && !slashClosed);
  useEffect(() => { if (!text.startsWith('/')) setSlashClosed(false); }, [text]);
  function closeReplies() { if (panel === 'replies') setPanel(''); if (slash !== null) setSlashClosed(true); }

  return <>
    <section className="bos-chat-thread" ref={box} aria-label={customer ? `与 ${customer.name} 的聊天` : '聊天'}>
      <header className="bos-chat-thread-head">
        <button type="button" className="bos-chat-icon-button bos-chat-back" onClick={onBack} aria-label="返回会话列表"><ArrowLeft size={20} /></button>
        {customer ? <GradeControl key={customerId} customerId={customerId} grade={customer.leadGrade} reason={customer.leadGradeReason} source={customer.leadGradeSource} gradedAt={customer.leadGradedAt}
          suggestion={thread.gradeSuggestion} timezone={timezone} onChanged={() => { profileChanged(); void reloadOutreach(); }} />
          : <span className="bos-chat-avatar bos-chat-grade is-none" aria-hidden="true" />}
        <div className="bos-chat-thread-title">
          <div><h2>{customer?.name ?? '加载中…'}</h2>{customer && <GradeFollow grade={customer.leadGrade} />}{customer && <span className="bos-chat-tag is-green">{label(stages, customer.stage)}</span>}{customer?.legacy && <LegacyTag />}
            {win && (win.status === 'OPEN' && left ? <span className={`bos-chat-window${left.minutes < 120 ? ' is-warning' : ''}`}><Clock3 size={12} aria-hidden="true" />24h 窗口剩 {left.text}</span>
              : <span className="bos-chat-window is-closed">{win.status === 'CLOSED' ? '24h 窗口已关闭' : '窗口未开启'}</span>)}</div>
          <p>{customer ? [customer.companyName, [customer.country, customer.city].filter(Boolean).join(' '), customer.whatsapp || customer.phone, `负责人 ${customer.owner.name}`].filter(Boolean).join(' · ') : ''}</p>
        </div>
        <div className="bos-chat-thread-actions">
          {thread && <button type="button" role="switch" aria-checked={autoOn} aria-label="自动翻译" className="bos-chat-auto-translate" onClick={toggleAuto}
            title={autoOn ? '客户的外语消息自动带中文；点一下关掉' : '打开后，客户的外语消息自动带中文'}><Languages size={15} aria-hidden="true" /><span>自动翻译</span><i aria-hidden="true" /></button>}
          {thread && <TodoMarkButton customerId={customerId} mark={thread.pendingMark} timezone={timezone} onChanged={profileChanged} />}
          <button type="button" className="bos-chat-icon-button" onClick={onToggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen ? '退出全屏聊天' : '全屏聊天'} title={fullscreen ? '退出全屏（Esc）' : '全屏聊天'}>{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
          <button type="button" className="bos-chat-icon-button" onClick={onToggleProfile} aria-pressed={profileOpen} aria-label={profileOpen ? '收起客户资料' : '查看客户资料'}><PanelRight size={18} /></button>
        </div>
      </header>
      {thread?.pendingMark && <TodoMarkBanner key={thread.pendingMark.dueAt + thread.pendingMark.note} customerId={customerId} mark={thread.pendingMark} timezone={timezone} onChanged={profileChanged} />}

      <div className="bos-chat-log" ref={log} onScroll={e => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}><div className="bos-chat-log-inner" ref={content}>
        {error && <p className="bos-chat-error" role="alert">{error}</p>}
        {!thread && !error && <p className="bos-chat-day">正在加载聊天记录…</p>}
        {cursor && <button type="button" className="bos-chat-older" onClick={older} disabled={busy === 'older'}>{busy === 'older' ? '加载中…' : '查看更早的消息'}</button>}
        {thread && !messages.length && <div className="bos-chat-empty-thread"><div><strong>还没有聊天记录</strong>{canChat ? '可以直接给客户发消息。' : '首次联系客户需要先发送已审核的模板消息，客户回复后即可自由聊天。'}</div></div>}
        {messages.map((message, index) => {
          const day = formatDay(message.sentAt, timezone), previous = index ? formatDay(messages[index - 1].sentAt, timezone) : '';
          const out = message.direction === 'OUTBOUND', body = visibleText(message);
          // What the salesperson wrote always shows; machine translations while 自动翻译 is on, or after a click on 翻译.
          const stored = message.translation ?? autoTranslated[message.id];
          const clicked = translations[message.id];
          const chinese = stored && (stored.kind === 'ORIGINAL' || autoOn) ? stored : typeof clicked === 'object' ? clicked : undefined;
          const failed = typeof clicked === 'string' && clicked !== TRANSLATING;
          return <Fragment key={message.id}>
            {day !== previous && <div className="bos-chat-day">{day}</div>}
            <article className={`bos-chat-bubble${out ? ' is-out' : ''}`}>
              {message.messageType === 'TEMPLATE' && <span className="bos-chat-bubble-label">模板消息</span>}
              <Media message={message} broken={broken.has(message.id)} onBroken={() => setBroken(set => new Set(set).add(message.id))} onLoad={keepAtBottom} />
              {body && <p>{body}</p>}
              {chinese ? <p className="bos-chat-translation"><span>{chinese.kind === 'ORIGINAL' ? (out ? '你写的中文' : '中文') : '机器翻译'}</span>{chinese.text}</p>
                : typeof clicked === 'string' && <p className="bos-chat-translation is-status">{clicked}</p>}
              <div className="bos-chat-bubble-meta">
                {!out && body.trim() && !chinese && (!clicked || failed) && (!autoOn || autoDown) && needsTranslation(message) && <button type="button" className="bos-chat-translate" onClick={() => translate(message.id)}>{failed ? '重试' : '翻译'}</button>}
                {message.source === 'whatsapp_web' && <span>本地同步</span>}
                <time dateTime={message.sentAt}>{formatTime(message.sentAt, timezone)}</time>
                {out && <Status status={message.status} />}
              </div>
            </article>
          </Fragment>;
        })}
      </div></div>

      {draft && <div className="bos-chat-draft">
        <div className="bos-chat-draft-head"><Sparkles size={16} aria-hidden="true" /><strong>建议回复</strong><small>AI 草稿 · 需人工确认后发送</small></div>
        <p>{draft.reply}</p>
        {draft.replyZh && <p className="bos-chat-draft-zh"><span>中文意思</span>{draft.replyZh}</p>}
        {draft.nextStep && <p className="bos-chat-draft-next"><span>建议下一步</span>{draft.nextStep}</p>}
        {draft.warnings.length > 0 && <p className="bos-chat-draft-next"><span>发送前请修改</span>{draft.warnings.join('；')}</p>}
        <div className="bos-chat-actions">
          <button type="button" className="is-primary" onClick={() => { setText(draft.reply); setOriginal(undefined); setDraft(undefined); }} disabled={!canChat}>填入输入框</button>
          {draft.quoteHref && <Link className="bos-chat-quote-link" href={draft.quoteHref}><FileText size={14} aria-hidden="true" />按对话生成报价单</Link>}
          <button type="button" onClick={() => aiDraft(draft.reply)} disabled={busy === 'draft'}>换一种说法</button>
          <button type="button" onClick={() => setDraft(undefined)}>忽略</button>
        </div>
      </div>}

      {thread && <footer className="bos-chat-composer">
        {!coarse && canChat && <ComposerHandle dragging={composer.dragging} handle={composer.handle} />}
        {!thread.sending.configured ? <div className="bos-chat-notice"><CircleAlert size={16} /><span><strong>WhatsApp 发送服务尚未配置。</strong>需要在服务器配置 Gupshup 业务号后才能从这里发消息，目前只能查看记录。</span></div>
          : thread.sending.optedOut ? <div className="bos-chat-notice"><CircleAlert size={16} /><span><strong>客户已明确退订。</strong>系统不会再向这个客户发送 WhatsApp 消息，请人工核对后续沟通许可。</span></div>
          : win?.status !== 'OPEN' && <div className="bos-chat-notice"><CircleAlert size={16} /><span><strong>{win?.status === 'CLOSED' ? '客户超过 24 小时没有回复' : '客户还没有通过公司业务号发来消息'}，WhatsApp 只允许发送已审核的模板消息。</strong>客户回复后，自动恢复自由聊天。</span></div>}

        <OutreachBar view={outreach} timezone={timezone} canTemplate={thread.sending.configured && thread.sending.templates && !thread.sending.optedOut} onUseTemplate={openTemplates} />

        {templates.open && <div>
          {templates.error && <p className="bos-chat-error" role="alert">{templates.error}</p>}
          {templates.status === 'NOT_CONNECTED' ? <div className="bos-chat-notice"><LayoutTemplate size={16} /><span><strong>模板消息尚未接入。</strong>需要在服务器配置 GUPSHUP_APP_ID，并在 Gupshup 后台创建模板、等待 Meta 审核通过。</span></div>
            : !templates.templates.length && !templates.error ? <p className="bos-chat-hint">没有已审核通过的文字模板。请先在 Gupshup 后台创建并等待审核。</p>
            : <div className="bos-chat-templates">
              <div className="bos-chat-template-list" role="radiogroup" aria-label="已审核模板">
                {templates.templates.map(t => <label key={t.id}><span><input type="radio" name="template" checked={templates.chosen === t.id} onChange={() => setTemplates(s => ({ ...s, chosen: t.id, params: paramsFor(s, t.id) }))} />{t.name}</span><small>{[t.language, t.category, templates.outreach?.templateId === t.id ? `系统分配 ${templates.outreach.scriptCode}` : templates.suggestion?.templateId === t.id ? '推荐' : ''].filter(Boolean).join(' · ')}</small>
                  <small className={`bos-chat-template-status${emptyIn(t.id) ? ' is-warning' : ''}`}>{emptyIn(t.id) ? `还有 ${emptyIn(t.id)} 个变量要填` : '变量已全部填好'}</small></label>)}
              </div>
              {chosenTemplate && <div className="bos-chat-template-preview">
                <small>预览 · 已按客户资料填好，发送前请核对</small>
                {templates.outreach?.templateId && templates.outreach.templateId !== chosenTemplate.id && <p className="bos-chat-var-note is-warning">没有用系统分配的话术 {templates.outreach.scriptCode}：话术由系统轮流分配，改发其他模板会让对比结果偏掉。</p>}
                <p>{preview.map((part, i) => part.variable ? <span key={i} className={`bos-chat-fill${part.empty ? ' is-empty' : ''}`}>{part.text}</span> : <Fragment key={i}>{part.text}</Fragment>)}</p>
                {templates.params.map((value, i) => {
                  const fill = fills[i];
                  const set = (next: string) => setTemplates(s => ({ ...s, params: s.params.map((p, j) => j === i ? next : p) }));
                  // auto: the record's value; changed: the salesperson typed over it; missing / unknown: nothing to fill from.
                  const state = fill?.value ? (value === fill.value ? 'auto' : 'changed') : value.trim() ? 'typed' : fill?.source ? 'missing' : 'unknown';
                  const chip = { auto: `自动 · ${fill?.label}`, changed: '已手动修改', typed: '已手动填写', missing: `${fill?.label} · 资料里没有`, unknown: '未识别' }[state];
                  return <div key={i} className="bos-chat-var">
                    <div className="bos-chat-var-head">
                      <span>变量 {`{{${i + 1}}}`}</span><span className={`bos-chat-var-chip is-${state}`}>{chip}</span>
                      {fill?.context && <small>模板里是「{fill.context}」</small>}
                      {state === 'changed' && <button type="button" onClick={() => set(fill!.value)}>恢复自动：{fill!.value}</button>}
                    </div>
                    <label><span className="bos-chat-sr">变量 {`{{${i + 1}}}`} 的值</span><input value={value} onChange={e => set(e.target.value)} aria-invalid={!value.trim()} /></label>
                    {fill?.note && state !== 'changed' && state !== 'typed' && <p className={`bos-chat-var-note${state === 'auto' ? '' : ' is-warning'}`}>{fill.note}</p>}
                    {fill?.source === 'productLine' && <div className="bos-chat-template-picks" role="group" aria-label="选择产品线">
                      {FIRST_TOUCH_PRODUCT_LINES.map(line => <button key={line.value} type="button" aria-pressed={value === line.value} onClick={() => set(line.value)}>{line.label}</button>)}
                    </div>}
                  </div>;
                })}
                <div className="bos-chat-actions"><button type="button" className="is-primary" onClick={sendTemplate} disabled={busy === 'template' || templates.params.some(p => !p.trim())}>{busy === 'template' ? '发送中…' : '发送模板'}</button><button type="button" onClick={() => setTemplates(s => ({ ...s, open: false }))}>取消</button></div>
              </div>}
            </div>}
        </div>}

        {repliesOpen && <QuickRepliesPanel ref={replies} customerId={customerId} query={slash !== null && !slashClosed ? slash : null} canChat={canChat} onClose={closeReplies}
          onPick={reply => {
            setText(reply.text); setPanel(''); setSlashClosed(false);
            // Kept with the message when it goes out, like a translation from Chinese.
            setOriginal(reply.language === 'zh' ? undefined : { text: reply.zh, language: REPLY_LANGUAGES[reply.language as keyof typeof REPLY_LANGUAGES] ?? reply.language });
            composer.input.current?.focus();
          }} />}
        {panel === 'polish' && <PolishPanel customerId={customerId} text={text} onClose={() => setPanel('')}
          onUse={s => {
            // 还原 brings back what was in the box; a line already translated from Chinese keeps that Chinese to restore.
            setOriginal(o => ({ text: o && !o.label ? o.text : text, language: '', zh: s.zh || undefined, label: s.angle }));
            setText(s.text); setPanel(''); composer.input.current?.focus();
          }} />}
        {panel === 'materials' && <MaterialsPanel customerId={customerId} timezone={timezone} canChat={canChat} onClose={() => setPanel('')}
          onSent={() => { stickToBottom.current = true; void load(true); onChanged(); void reloadOutreach(); }} />}
        <div className="bos-chat-tools">
          <input ref={file} type="file" accept={ACCEPT} hidden onChange={e => upload(e.target.files?.[0])} />
          <button type="button" className="bos-chat-chip" onClick={() => file.current?.click()} disabled={!canChat || busy === 'upload'}>{busy === 'upload' ? <Loader2 size={14} /> : <Paperclip size={14} />}图片 / 文件</button>
          <button type="button" className="bos-chat-chip" aria-expanded={panel === 'materials'} onClick={() => setPanel(panel === 'materials' ? '' : 'materials')}><BookOpen size={14} />产品资料</button>
          <button type="button" className="bos-chat-chip" aria-expanded={panel === 'replies'} onClick={() => setPanel(panel === 'replies' ? '' : 'replies')}><MessageSquareText size={14} />常用回复</button>
          <button type="button" className="bos-chat-chip" onClick={() => aiDraft()} disabled={busy === 'draft' || !messages.length || !thread.ai.configured} title={thread.ai.configured ? '按聊天记录和产品库写一条回复，确认后再发' : '需要在服务器配置 DeepSeek'}>{busy === 'draft' ? <Loader2 size={14} /> : <Sparkles size={14} />}AI 草稿</button>
          <button type="button" className="bos-chat-chip" onClick={translateOut} disabled={busy === 'translate' || !text.trim() || !thread.ai.configured} title={thread.ai.configured ? '把输入框里的中文译成客户使用的语言' : '需要在服务器配置 DeepSeek'}>{busy === 'translate' ? <Loader2 size={14} /> : <Languages size={14} />}译成客户语言</button>
          {thread.sending.configured && !thread.sending.optedOut && <button type="button" className="bos-chat-chip" onClick={openTemplates}><LayoutTemplate size={14} />模板消息</button>}
          <Link className="bos-chat-chip" href={`/products/quotes/new?customerId=${encodeURIComponent(customerId)}`}><FileText size={14} />报价单</Link>
          <button type="button" className="bos-chat-chip bos-chat-polish-chip" aria-expanded={panel === 'polish'} onClick={() => setPanel(panel === 'polish' ? '' : 'polish')}
            disabled={!text.trim() || !canChat || !thread.ai.configured} title={!thread.ai.configured ? '需要在服务器配置 DeepSeek' : text.trim() ? '给输入框里这句话三种更好的写法' : '先在输入框写一句'}><Wand2 size={14} />优化话术</button>
        </div>
        {attachment && <span className="bos-chat-attachment"><Paperclip size={13} aria-hidden="true" /><span>{attachment.fileName}</span><button type="button" className="bos-chat-icon-button" style={{ width: 26, height: 26 }} onClick={() => setAttachment(undefined)} aria-label="移除附件"><X size={14} /></button></span>}
        <div className="bos-chat-input">
          <label className="bos-chat-sr" htmlFor={`composer-${customerId}`}>输入消息</label>
          <div className="bos-chat-input-box">
            <textarea ref={composer.input} id={`composer-${customerId}`} rows={2} value={text} disabled={!canChat} onChange={e => setText(e.target.value)}
              placeholder={canChat ? (attachment?.mimeType.startsWith('audio/') ? '语音文件不能附带文字' : '输入消息…') : '当前只能发送模板消息'}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing) return;
                // While typing "/" the input is the search: ↑↓ and Enter pick a reply and never send.
                if (slash !== null && !slashClosed && replies.current?.key(e)) { e.preventDefault(); return; }
                if (e.key !== 'Enter') return;
                // 放大 is for long messages: Enter starts a new line there and ⌘ / Ctrl + Enter sends.
                if (composer.big ? e.metaKey || e.ctrlKey : !e.shiftKey && !coarse) { e.preventDefault(); void send(); }
              }} />
            {canChat && <button type="button" className="bos-chat-expand" aria-pressed={composer.big} onClick={() => { composer.setBig(!composer.big); composer.input.current?.focus(); }}
              aria-label={composer.big ? '还原输入框' : '放大输入框，写长消息'} title={composer.big ? '还原输入框' : '放大输入框，写长消息'}>{composer.big ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
          </div>
          <button type="button" className="bos-chat-icon-button is-primary bos-chat-send" onClick={send} disabled={!canChat || busy === 'send' || (!text.trim() && !attachment)} aria-label="发送">{busy === 'send' ? <Loader2 size={19} /> : <Send size={19} />}</button>
        </div>
        {original && <p className="bos-chat-original"><span>{original.label ? `已用「${original.label}」的写法 · 你写的：${original.text}` : `已译成${original.language} · 原文：${original.text}`}</span><button type="button" onClick={() => { setText(original.text); setOriginal(undefined); }}><Undo2 size={13} aria-hidden="true" />还原</button></p>}
        {sendError && <p className="bos-chat-error" role="alert">{sendError}</p>}
        <p className="bos-chat-hint">{[composer.big ? 'Enter 换行 · ⌘ / Ctrl + Enter 发送 · 再点右上角还原' : coarse ? '' : `Enter 发送 · Shift + Enter 换行 · 拖动上方横杠调高度${composer.adjusted ? '（已记住）' : ''}`,
          `通过公司业务号${thread.sending.businessNumber ? ` ${thread.sending.businessNumber}` : ''}发出，记录自动存入客户档案`].filter(Boolean).join(' · ')}</p>
      </footer>}
    </section>

    <aside className="bos-chat-profile" aria-label="客户资料">
      <div className="bos-chat-profile-head"><h2>客户资料</h2><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Link href={`/customers/${encodeURIComponent(customerId)}`}>完整档案<ArrowUpRight size={13} /></Link><button type="button" className="bos-chat-icon-button" onClick={onToggleProfile} aria-label="收起客户资料"><X size={16} /></button></span></div>
      {customer && <>
        <div className="bos-chat-person"><GradeAvatar grade={customer.leadGrade} reason={customer.leadGradeReason} size="large" />
          <div><strong>{customer.name}{used('firstName')}</strong><span>{customer.companyName || '公司待补充'}</span><span>{[customer.country, customer.city].filter(Boolean).join(' · ') || '国家待补充'}{customer.language ? ` · ${customer.language}` : ''}</span></div></div>
        <TagEditor customerId={customerId} tags={thread.tags} admin={admin} onChanged={profileChanged} />
        <StageControl customerId={customerId} stage={customer.stage} hasDeal={customer.hasDeal} invalidReason={customer.invalidReason} currency={customer.currency}
          last={thread.stageEvents[0] ? { by: thread.stageEvents[0].by, changedAt: thread.stageEvents[0].changedAt, toStage: thread.stageEvents[0].toStage } : null}
          timezone={timezone} onChanged={profileChanged} />
        <DemandCard customerId={customerId} lastInboundAt={lastInboundAt} canChat={canChat} onAsk={line => { setText(current => current.trim() ? `${current.trim()} ${line}` : line); setOriginal(undefined); }} />
        <dl className="bos-chat-facts">
          <dt>意向产品</dt><dd>{[customer.productInterest, customer.productModel].filter(Boolean).join(' · ') || '—'}{used('productLine')}</dd>
          <dt>采购类型</dt><dd>{customer.purchaseType === 'OTHER' ? '—' : label(purchases, customer.purchaseType)}</dd>
          <dt>采购数量</dt><dd>{customer.quantity ? customer.quantity : '—'}</dd>
          <dt>来源</dt><dd>{label(sources, customer.source)}</dd>
          <dt>询盘日期</dt><dd>{customer.inquiryAt ? formatDateTime(customer.inquiryAt, timezone) : '—'}</dd>
          <dt>负责人</dt><dd>{customer.owner.name}{used('owner')}</dd>
        </dl>
        <div>
          <div className="bos-chat-section-title"><strong style={{ color: '#1c3226' }}>下一步跟进</strong><Link className="bos-chat-link" href={`/customers/${encodeURIComponent(customerId)}`}>去安排</Link></div>
          {thread.nextTask ? <div className={`bos-chat-task${Date.parse(thread.nextTask.dueDate) > Date.now() + 86400000 ? ' is-calm' : ''}`} style={{ marginTop: 8 }}><strong>{thread.nextTask.title}</strong><span><Clock3 size={13} aria-hidden="true" />{Date.parse(thread.nextTask.dueDate) < Date.now() ? '已到期 · ' : ''}{formatDateTime(thread.nextTask.dueDate, timezone)}</span></div>
            : <p className="bos-chat-hint" style={{ display: 'block' }}>暂无待办，可在客户档案中安排下一次跟进。</p>}
        </div>
        <OutreachProfile view={outreach} customerId={customerId} onChanged={() => { void reloadOutreach(); void load(true); }} />
        {(customer.aiSummary || customer.leadGrade || thread.ai.configured) && <div className="bos-chat-ai">
          <div className="bos-chat-section-title"><strong style={{ color: '#1c3226' }}>AI 摘要</strong>
            {thread.ai.configured && <button type="button" className="bos-chat-link" onClick={refreshSummary} disabled={busy === 'summary'}>{busy === 'summary' ? <Loader2 size={13} /> : <RefreshCw size={13} />}{customer.aiSummary ? '更新' : '生成'}</button>}</div>
          {customer.leadGrade && <p className="bos-chat-ai-grade">表单 {customer.leadGrade} 级{customer.leadGradeReason ? `：${customer.leadGradeReason}` : ''}</p>}
          {customer.aiSummary ? <>
            <p>{customer.aiSummary}</p>
            {customer.aiNextAction && <p className="bos-chat-draft-next"><span>建议下一步</span>{customer.aiNextAction}</p>}
            {customer.aiLastAnalyzedAt && <small>更新于 {formatDateTime(customer.aiLastAnalyzedAt, timezone)}</small>}
          </> : <p className="bos-chat-hint" style={{ display: 'block' }}>{thread.ai.configured ? '点「生成」，AI 读一遍聊天记录，总结客户要什么、卡在哪里。' : '配置 DeepSeek 后可自动总结聊天。'}</p>}
        </div>}
        {!!thread.stageEvents.length && <div>
          <div className="bos-chat-section-title" style={{ marginBottom: 10 }}><strong style={{ color: '#1c3226' }}>阶段变化</strong></div>
          <ol className="bos-chat-events">{thread.stageEvents.map(e => <li key={e.id}><i aria-hidden="true" /><span>{e.fromStage ? `${label(stages, e.fromStage)} → ` : ''}{label(stages, e.toStage)}<small>{formatDateTime(e.changedAt, timezone)}</small></span></li>)}</ol>
        </div>}
        <div className="bos-chat-profile-actions">
          <Link href={`/products/quotes/new?customerId=${encodeURIComponent(customerId)}`}>新建报价单</Link>
          <Link className="is-primary" href={`/customers/${encodeURIComponent(customerId)}`}>客户档案</Link>
        </div>
      </>}
    </aside>
  </>;
}
