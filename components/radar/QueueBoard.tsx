'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Pause, Pin, Play } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Header, Table } from '@/components/ui/bos';
import { api } from '@/lib/client';
import type { queueView } from '@/services/radar-queue-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Data = Jsonify<Awaited<ReturnType<typeof queueView>>>;
type Row = Data['rows'][number];

const VIEWS = [['ACTIVE', '待发送', ['PREPARING', 'REVIEW', 'QUEUED', 'SENDING']], ['SENT', '已发送（7 天）', ['SENT', 'BOUNCED']], ['PROBLEM', '失败与状态不明', ['FAILED', 'UNKNOWN']], ['CANCELLED', '已取消（7 天）', ['CANCELLED']]] as const;
const TONE: Record<string, 'green' | 'warning' | 'neutral'> = { SENT: 'green', REVIEW: 'warning', FAILED: 'warning', UNKNOWN: 'warning', BOUNCED: 'warning' };
export const when = (iso: string | null, tz: string) => iso ? new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—';

/** 发送队列: today's plan, each mailbox's progress, and every mail with its status and planned time. */
export function QueueBoard({ data }: { data: Data }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState({ opening: '', subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true); setError(''); setMessage('');
    try { await task(); setMessage(done); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const act = (row: Row, body: Record<string, unknown>, done: string) => run(() => api(`radar/sends/${row.id}`, 'PATCH', body), done);
  const expand = (row: Row) => { setOpen(open === row.id ? null : row.id); setDraft({ opening: row.opening, subject: row.subject, body: row.body }); };
  const count = (statuses: readonly string[]) => statuses.reduce((sum, s) => sum + (data.counts[s] ?? 0), 0);
  const tz = data.companyTimezone;

  return <div className="bos-radar">
    <Header title="发送队列" description={`今天计划 ${data.today.planned} 封 · 已发 ${data.today.sent} 封。信按每个邮箱的额度、6–15 分钟随机间隔和客户当地工作时间发出；插队只是排到前面，仍然遵守间隔和限额。`}
      actions={<Button variant={data.paused ? 'primary' : 'secondary'} disabled={busy} onClick={() => run(() => api('radar/queue/pause', 'PUT', { paused: !data.paused }), data.paused ? '已继续发送' : '已暂停发送，正在发送的一封会发完')}>
        {data.paused ? <><Play size={15} aria-hidden="true" />继续发送</> : <><Pause size={15} aria-hidden="true" />暂停发送</>}</Button>} />
    {!data.sendingEnabled && <p className="bos-radar-notice" role="status"><AlertTriangle size={15} aria-hidden="true" />服务器没有开启 RADAR_SEND_ENABLED：队列照常排，但不会真正发信。正式发信前在 Hostinger 环境变量里设为 true。</p>}
    {data.paused && <p className="bos-radar-notice" role="status"><AlertTriangle size={15} aria-hidden="true" />发送已暂停，点「继续发送」恢复。</p>}
    {data.strictReview && <p className="bos-radar-message" role="status">上线后两周内，每封第 1 封信都要在「待复核」里人工通过后才会发出。</p>}
    {message && <p className="bos-radar-message" role="status">{message}</p>}
    {error && <p className="bos-sales-error" role="alert">{error}</p>}

    {data.mailboxes.length ? <div className="bos-radar-boxes">{data.mailboxes.map(m => <Card key={m.id} className="bos-radar-box">
      <div className="bos-radar-card-head"><strong>{m.address}</strong>{!m.connected ? <Badge tone="warning">授权失效</Badge> : m.status === 'PAUSED' ? <Badge tone="warning">已暂停</Badge> : <Badge tone="green">正常</Badge>}</div>
      <div className="bos-radar-progress" role="img" aria-label={`今天已发 ${m.sentToday} / ${m.cap} 封`}><span style={{ width: m.cap ? `${Math.min(100, Math.round(m.sentToday / m.cap * 100))}%` : '0%' }} /></div>
      <p className="bos-radar-meta">今天 {m.sentToday} / {m.cap} 封 · 预热第 {m.week} 周{m.status === 'ACTIVE' && m.nextSendAt ? ` · 下一封最早 ${when(m.nextSendAt, tz)}` : ''}</p>
      {m.pausedReason && <p className="bos-radar-error">{m.pausedReason}</p>}
    </Card>)}</div> : <Card><EmptyState title="还没有发信邮箱" description="在 设置 · 客户雷达 里连接 Google Workspace 发信邮箱，并填写预热开始日期。" action={<Link className="bos-button bos-button-secondary" href="/settings/radar">去连接</Link>} /></Card>}

    <nav className="bos-radar-tabs" aria-label="队列分类">{VIEWS.map(([key, label, statuses]) => <Link key={key} href={key === 'ACTIVE' ? '/radar/queue' : `/radar/queue?view=${key}`}
      aria-current={data.view === key ? 'page' : undefined}>{label}{count(statuses) ? ` ${count(statuses)}` : ''}</Link>)}</nav>

    {!data.rows.length ? <Card><EmptyState title="这里没有信" description={data.view === 'ACTIVE' ? '在雷达客户里点「发开发信」或勾选多家「加入发送队列」。' : '最近 7 天没有这类信。'} /></Card>
      : <Card><div className="bos-radar-table"><Table caption="发送队列" headings={['客户', '封次 · 模板', '收件邮箱', '状态', data.view === 'ACTIVE' ? '计划发送（客户当地 / 北京）' : '时间', '发信邮箱', '操作']}>
        {data.rows.map(row => <Fragment key={row.id}><tr>
          <td><strong>{row.prospect.name}</strong><small>{[row.prospect.city, row.prospect.countryName].filter(Boolean).join(' · ')}</small></td>
          <td>第 {row.step} 封<small>{row.templateCode || '—'}{row.edited ? ' · 已改正文' : ''}</small></td>
          <td>{row.toAddress}{row.risky && <small>风险地址</small>}</td>
          <td><Badge tone={TONE[row.status] ?? 'neutral'}>{row.status === 'QUEUED' && row.scheduledToday ? '已安排' : row.statusLabel}</Badge>{row.pinned && <small><Pin size={11} aria-hidden="true" /> 已插队</small>}
            {row.cancelLabel && <small>{row.cancelLabel}</small>}{row.lastError && row.status !== 'SENT' && <small>{row.lastError}</small>}{row.attempts > 0 && row.status === 'QUEUED' && <small>第 {row.attempts} 次失败后重试</small>}</td>
          <td>{data.view === 'ACTIVE' ? (row.plannedAt ? <>{row.status === 'REVIEW' && <small>审核通过后约</small>}{when(row.plannedAt, row.prospect.timezone)}<small>北京 {when(row.plannedAt, tz)}</small></> : row.status === 'REVIEW' ? '审核通过后排期' : '—')
            : <>{when(row.sentAt ?? row.updatedAt, row.prospect.timezone)}<small>北京 {when(row.sentAt ?? row.updatedAt, tz)}</small></>}</td>
          <td>{row.mailbox || row.plannedMailbox || '—'}</td>
          <td><div className="bos-radar-actions">
            <Button variant="ghost" onClick={() => expand(row)} aria-expanded={open === row.id}>{open === row.id ? '收起' : '预览'}</Button>
            {row.status === 'REVIEW' && <Link className="bos-button bos-button-ghost" href="/radar/review">去审核</Link>}
            {['PREPARING', 'REVIEW', 'QUEUED'].includes(row.status) && <Button variant="ghost" disabled={busy} onClick={() => act(row, { action: row.pinned ? 'unpin' : 'pin' }, row.pinned ? '已取消插队' : '已插到最前，仍然遵守间隔和限额')}>{row.pinned ? '取消插队' : '插队'}</Button>}
            {row.status === 'FAILED' && <Button disabled={busy} onClick={() => act(row, { action: 'retry' }, '已重新排队')}>重发</Button>}
            {['PREPARING', 'REVIEW', 'QUEUED', 'FAILED'].includes(row.status) && <Button variant="ghost" disabled={busy} onClick={() => act(row, { action: 'cancel' }, `已取消发给 ${row.prospect.name} 的信，这家公司的序列停止`)}>取消</Button>}
            {row.status === 'UNKNOWN' && <><Button disabled={busy} onClick={() => act(row, { action: 'confirmSent' }, '已记为发出')}>已确认发出</Button>
              <Button variant="ghost" disabled={busy} onClick={() => act(row, { action: 'confirmNotSent' }, '已重新排队')}>确认未发出</Button></>}
          </div></td>
        </tr>
        {open === row.id && <tr className="bos-radar-preview-row"><td colSpan={7}><div className="bos-radar-preview">
          {['REVIEW', 'QUEUED'].includes(row.status) ? <>
            {row.step === 1 && <label><span>个性化开头{row.openingSource === 'AI' ? '（AI 写的，发出前需人工通过）' : ''}</span><input className="bos-input" value={draft.opening} maxLength={500} onChange={e => setDraft({ ...draft, opening: e.target.value })} /></label>}
            {row.step === 1 && <label><span>主题</span><input className="bos-input" value={draft.subject} maxLength={300} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label>}
            <label><span>正文（签名和退订句在发送时自动附上）</span><textarea className="bos-input" rows={8} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
            <p className="bos-radar-hint">只改开头时正文会按模板重新生成；直接改正文后，这封信不计入模板对比。</p>
            <div className="bos-radar-actions"><Button variant="primary" disabled={busy} onClick={() => act(row, {
              action: 'edit', ...(draft.opening !== row.opening ? { opening: draft.opening } : {}), ...(row.step === 1 && draft.subject !== row.subject ? { subject: draft.subject } : {}),
              ...(draft.body !== row.body && draft.opening === row.opening ? { body: draft.body } : {}),
            }, '已保存')}>保存</Button></div>
          </> : <><p><strong>{row.subject || '（同一线程回复）'}</strong></p><pre className="bos-radar-mail">{row.body || '正在写个性化开头…'}</pre></>}
        </div></td></tr>}
        </Fragment>)}
      </Table></div></Card>}
  </div>;
}
