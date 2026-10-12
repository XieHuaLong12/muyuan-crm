import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { Archive,ArrowLeft,ArrowRight,ArrowUpRight,FileText,Search } from 'lucide-react';
import { stages } from '@/lib/constants';
import type { CommunicationHistoryData } from '@/services/communication-history-service';

function historyHref(query: CommunicationHistoryData['query'], patch: Partial<CommunicationHistoryData['query']> = {}) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.page > 1) params.set('page', String(next.page));
  if (next.customer) params.set('customer', next.customer);
  if (next.before) params.set('before', next.before);
  if (next.ownerId) params.set('ownerId', next.ownerId);
  return `/communication${params.size ? `?${params}` : ''}`;
}

function time(value: Date, timezone: string, pattern: string) {
  return formatInTimeZone(value, timezone, pattern);
}

const statusLabels: Record<string, string> = {
  SENT: '已提交', DELIVERED: '已送达', READ: '已读', FAILED: '发送失败',
  PENDING: '发送中', UNKNOWN: '结果未知', RECEIVED: '已接收',
};

type HistoryMessage = CommunicationHistoryData['messages'][number];

function Attachment({ message }: { message: HistoryMessage }) {
  const url = message.mediaUrl;
  const safeUrl = url && (url.startsWith('https://') || url.startsWith('/api/whatsapp/media/')) ? url : null;
  if (safeUrl) return <a className="bos-history-attachment" href={safeUrl} target="_blank" rel="noreferrer">
    <FileText size={17} aria-hidden="true" />{message.fileName || `${message.messageType} 附件`}<ArrowUpRight size={14} aria-hidden="true" />
  </a>;
  if (!message.attachmentMetadata) return message.fileName ? <span className="bos-history-attachment is-unavailable"><FileText size={17} />{message.fileName} · 文件未归档</span> : null;
  let files: { fileName?: string; kind?: string }[] = [];
  try { files = JSON.parse(message.attachmentMetadata); } catch { return null; }
  if (!Array.isArray(files)) return null;
  return <div className="bos-history-attachments">{files.map((file, index) => <span className="bos-history-attachment is-unavailable" key={`${file.fileName || file.kind}-${index}`}>
    <FileText size={17} aria-hidden="true" />{file.fileName || file.kind || '历史附件'} · 仅留存文件信息
  </span>)}</div>;
}

export function CommunicationHistory({ data, timezone }: { data: CommunicationHistoryData; timezone: string }) {
  const { query, conversations, selected, messages } = data;
  return <section className="bos-history-layout" aria-label="WhatsApp 聊天记录档案">
    <aside className="bos-history-index">
      <header className="bos-history-index-head"><div><h2>销售沟通记录</h2></div><strong>{data.total}</strong></header>
      <form action="/communication" className="bos-history-supervision-filter"><label>销售负责人<select name="ownerId" aria-label="筛选销售负责人" defaultValue={query.ownerId}><option value="">全部负责人</option>{data.sales.map(s=><option key={s.id} value={s.id}>{s.name}{s.isActive?'':'（已停用）'}</option>)}</select></label><div className="bos-history-search"><Search size={16} aria-hidden="true" /><input name="q" type="search" defaultValue={query.q} aria-label="搜索有聊天记录的客户" placeholder="搜索客户、公司或国家" /><button type="submit">筛选</button></div></form>
      <p className="bos-history-index-note">仅显示已有 WhatsApp 历史记录的客户，按最新消息排序。</p>
      <div className="bos-history-conversations">
        {conversations.map(conversation => <Link key={conversation.id} href={historyHref(query, { customer: conversation.id, before: undefined })} className="bos-history-conversation" aria-current={selected?.id === conversation.id ? 'true' : undefined}>
          <span className="bos-history-avatar" aria-hidden="true">{conversation.name.slice(0, 1)}</span>
          <span className="bos-history-conversation-body"><span className="bos-history-conversation-top"><strong>{conversation.name}</strong><time>{conversation.lastMessageAt ? time(conversation.lastMessageAt, timezone, 'MM/dd HH:mm') : ''}</time></span>
            <small>{conversation.owner.name} · {[conversation.companyName, conversation.country].filter(Boolean).join(' · ') || '客户资料待补充'}</small>
            <span className="bos-history-preview">{conversation.lastMessage?.direction === 'OUTBOUND' ? '我方：' : '客户：'}{conversation.lastMessage?.content || conversation.lastMessage?.fileName || '附件消息'}</span>
            <span className="bos-history-count">{conversation.messageCount} 条记录</span>
          </span>
        </Link>)}
        {!conversations.length && <div className="bos-history-empty-index"><Archive size={24} /><strong>{query.q ? '没有找到匹配的记录' : '还没有聊天记录'}</strong><p>{query.q ? '试试其他客户名称或清除搜索条件。' : '收到或同步 WhatsApp 消息后，客户会出现在这里。'}</p>{query.q && <Link href="/communication">清除搜索</Link>}</div>}
      </div>
      {data.total > data.pageSize && <nav className="bos-history-pages" aria-label="客户档案分页"><span>第 {query.page} 页</span><div>{query.page > 1 && <Link href={historyHref(query, { page: query.page - 1, customer: undefined, before: undefined })} aria-label="上一页客户"><ArrowLeft size={16} /></Link>}{query.page * data.pageSize < data.total && <Link href={historyHref(query, { page: query.page + 1, customer: undefined, before: undefined })} aria-label="下一页客户"><ArrowRight size={16} /></Link>}</div></nav>}
    </aside>

    <div className="bos-history-record">
      {selected ? <>
        <header className="bos-history-record-head"><div><span className="bos-v2-kicker">WhatsApp · 只读</span><h2>{selected.name}</h2><p>当前负责人：{selected.owner.name} · {[selected.companyName, selected.country, stages[selected.stage as keyof typeof stages] || selected.stage].filter(Boolean).join(' · ')}</p></div><div className="bos-history-record-actions"><Link href={`/customers/${selected.id}`}>客户资料<ArrowUpRight size={14} /></Link></div></header>
        <div className="bos-history-summary"><Archive size={16} aria-hidden="true" /><span>按时间保存客户与我方的沟通记录。此处只供查阅，不会发送消息。</span></div>
        <div className="bos-history-log">
          {data.viewingOlder && <Link className="bos-history-older" href={historyHref(query, { before: undefined })}>返回最新记录</Link>}
          {data.nextCursor && <Link className="bos-history-older" href={historyHref(query, { customer: selected.id, before: data.nextCursor })}>查看更早记录</Link>}
          {messages.map((message, index) => {
            const day = time(message.sentAt, timezone, 'yyyy年M月d日');
            const previous = index ? time(messages[index - 1].sentAt, timezone, 'yyyy年M月d日') : '';
            return <div key={message.id}>{day !== previous && <div className="bos-history-day"><span>{day}</span></div>}
              <article className={`bos-history-entry${message.direction === 'OUTBOUND' ? ' is-outbound' : ''}`}>
                <div className="bos-history-entry-head"><strong>{message.direction === 'OUTBOUND' ? '我方发送' : '客户消息'}</strong><time dateTime={message.sentAt.toISOString()}>{time(message.sentAt, timezone, 'HH:mm')}</time><span>{message.source === 'whatsapp_web' ? '本地同步' : 'WhatsApp'}</span></div>
                {message.content && <p>{message.content}</p>}
                <Attachment message={message} />
                {message.direction === 'OUTBOUND' && <small className={message.status === 'FAILED' ? 'is-error' : undefined}>{statusLabels[message.status.toUpperCase()] || message.status}</small>}
              </article>
            </div>;
          })}
        </div>
      </> : <div className="bos-history-empty-record"><Archive size={32} /><h2>客户沟通留痕</h2><p>选择左侧客户，查看已保存的 WhatsApp 消息。新增聊天可通过本地同步助手归档。</p><Link href="/communication/whatsapp-sync">打开本地同步助手<ArrowUpRight size={14} /></Link></div>}
    </div>
  </section>;
}
