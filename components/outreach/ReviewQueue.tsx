'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, EmptyState, Header } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { CHANNELS, MATCH_TYPES, OVERRIDE_REASONS, QUALITIES, SIGNAL_GROUPS } from '@/lib/outreach';
import type { reviewList } from '@/services/outreach-review-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Data = Jsonify<Awaited<ReturnType<typeof reviewList>>>;
type TouchRow = Data['touches'][number];
type ReplyRow = Data['replies'][number];

const TABS = [
  { key: 'touches', label: '待复核触达', hint: 'DeepSeek 置信度低于 0.7、序号对不上，或还没判出用了哪条话术' },
  { key: 'replies', label: '需人工查看的回复', hint: '图片、语音回复系统不转写，听完或看完后改判' },
  { key: 'grades', label: '等级建议', hint: '客户回复和等级矛盾时 DeepSeek 给出的建议，一键确认' },
  { key: 'hot', label: '高意向积压', hint: '高意向回复超过 24 小时还没报价' },
] as const;
const dateTime = (iso: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const reasons = Object.entries(OVERRIDE_REASONS);

/** 人工复核: what the AI was unsure of, photos and voice notes, and grade suggestions. Corrections are logged with a reason. */
export function ReviewQueue({ data }: { data: Data }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  async function submit(id: string, path: string, body: Record<string, unknown>) {
    setBusy(id); setError('');
    try { await api(path, 'POST', body); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const tab = TABS.find(t => t.key === data.tab)!;
  return <div className="bos-outreach">
    <Header title="人工复核" description="每天上午 CRM 整理时处理。改判必须选原因，统计一律按改后的结果，DeepSeek 的原判保留在修改记录里。" />
    <nav className="bos-tabs" aria-label="复核类别">{TABS.map(t => <Link key={t.key} href={`/outreach/review?tab=${t.key}`} aria-current={data.tab === t.key ? 'page' : undefined}>{t.label}<span>{data.counts[t.key]}</span></Link>)}</nav>
    <p className="bos-wb-muted bos-outreach-hint">{tab.hint}</p>
    {error && <p className="bos-sales-error" role="alert">{error}</p>}
    {data.tab === 'touches' ? (data.touches.length ? <div className="bos-outreach-review">{data.touches.map(t => <TouchCard key={t.id} row={t} scripts={data.scripts} busy={busy === t.id} submit={submit} />)}</div>
      : <Card><EmptyState title="没有待复核的触达" description="DeepSeek 拿不准的手机端消息会出现在这里。" /></Card>)
      : data.replies.length ? <div className="bos-outreach-review">{data.replies.map(r => <ReplyCard key={r.id} row={r} tab={data.tab} busy={busy === r.id} submit={submit} />)}</div>
      : <Card><EmptyState title="这里是空的" description="有新的需要人工处理的回复时会出现在这里。" /></Card>}
  </div>;
}

type Submit = (id: string, path: string, body: Record<string, unknown>) => Promise<void>;

function TouchCard({ row, scripts, busy, submit }: { row: TouchRow; scripts: Data['scripts']; busy: boolean; submit: Submit }) {
  const options = scripts.filter(s => s.position === row.code);
  const [scriptId, setScriptId] = useState(row.scriptId ?? '');
  const [matchType, setMatchType] = useState(row.matchType || (row.scriptId ? 'LIGHT' : 'FREE'));
  const [reason, setReason] = useState('AI_WRONG');
  const [note, setNote] = useState('');
  const chosen = options.find(s => s.id === scriptId);
  return <Card className="bos-outreach-review-card">
    <div className="bos-outreach-review-head">
      <Link href={`/messages?customer=${row.customer.id}`}><strong>{row.customer.name}</strong></Link>
      <span className="bos-chat-tag is-green">{row.codeLabel}</span>
      <small>{dateTime(row.sentAt)} · {CHANNELS[row.channel as keyof typeof CHANNELS] ?? row.channel}{row.sender ? ` · ${row.sender}` : ''} · {row.customer.leadGrade ? `${row.customer.leadGrade} 类` : '未评级'} · {row.customer.owner.name}</small>
    </div>
    <p className="bos-outreach-script">{row.text}</p>
    <p className="bos-wb-muted">{row.judgedBy === 'AI' ? 'DeepSeek' : '系统'}：{row.scriptCode ? `${row.scriptCode} · ` : ''}{MATCH_TYPES[row.matchType as keyof typeof MATCH_TYPES] ?? '未判定'}{row.confidence !== null && !row.reason.includes('置信度') ? ` · 置信度 ${row.confidence.toFixed(2)}` : ''}{row.reason ? ` · ${row.reason}` : ''}</p>
    <div className="bos-outreach-form-grid">
      <label><span>话术编号</span><select className="bos-input" value={scriptId} onChange={e => setScriptId(e.target.value)}><option value="">不是话术库里的话术</option>{options.map(s => <option key={s.id} value={s.id}>{s.code}{s.language !== row.language ? `（${s.language}）` : ''}</option>)}</select></label>
      <label><span>匹配类型</span><select className="bos-input" value={matchType} onChange={e => setMatchType(e.target.value)}>{Object.entries(MATCH_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><span>修改原因</span><select className="bos-input" value={reason} onChange={e => setReason(e.target.value)}>{reasons.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><span>备注</span><input className="bos-input" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
    </div>
    {chosen && <details className="bos-review-detail"><summary>对照 {chosen.code} 原文</summary><p className="bos-outreach-script">{chosen.content}</p></details>}
    <div className="bos-wb-form-actions">
      <Button variant="primary" disabled={busy} onClick={() => submit(row.id, `outreach/review/touch/${row.id}`, { scriptId: matchType === 'FREE' ? null : scriptId || null, matchType, reason, note })}>保存改判</Button>
      {row.scriptId && row.matchType && <Button disabled={busy} onClick={() => submit(row.id, `outreach/review/touch/${row.id}`, { confirm: true })}>判定无误</Button>}
    </div>
  </Card>;
}

function ReplyCard({ row, tab, busy, submit }: { row: ReplyRow; tab: Data['tab']; busy: boolean; submit: Submit }) {
  const [quality, setQuality] = useState(row.quality || 'ENGAGED');
  const [signals, setSignals] = useState<string[]>(row.signals);
  const [reason, setReason] = useState(row.needsHuman ? 'VOICE_IMAGE' : 'AI_WRONG');
  const [note, setNote] = useState('');
  return <Card className="bos-outreach-review-card">
    <div className="bos-outreach-review-head">
      <Link href={`/messages?customer=${row.customer.id}`}><strong>{row.customer.name}</strong></Link>
      {row.quality && <Badge tone={row.quality === 'HIGH' ? 'green' : row.quality === 'REJECT' ? 'warning' : 'neutral'}>{QUALITIES[row.quality as keyof typeof QUALITIES]}</Badge>}
      {row.needsHuman && <span className="bos-chat-tag is-warning">含图片 / 语音</span>}
      <small>{dateTime(row.receivedAt)} · 当前 {row.customer.leadGrade ? `${row.customer.leadGrade} 类` : '未评级'} · {row.customer.owner.name}</small>
    </div>
    <p className="bos-outreach-script">{row.text}</p>
    {row.reason && <p className="bos-wb-muted">{row.judgedBy === 'AI' ? 'DeepSeek' : row.judgedBy === 'BUTTON' ? '模板按钮' : '规则'}：{row.reason}</p>}
    {row.nextStep && <p className="bos-chat-draft-next"><span>建议下一步</span>{row.nextStep}</p>}
    {tab === 'grades' ? <div className="bos-wb-form-actions">
      <Button variant="primary" disabled={busy} onClick={() => submit(row.id, 'outreach/grade', { action: 'ACCEPT', replyId: row.id })}>确认改为 {row.gradeSuggestion} 类</Button>
      <label className="bos-wb-inline"><span className="bos-sr-only">不采纳的原因</span><select className="bos-input" value={reason} onChange={e => setReason(e.target.value)}>{reasons.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <Button disabled={busy} onClick={() => submit(row.id, 'outreach/grade', { action: 'DISMISS', replyId: row.id, reason, note })}>不采纳</Button>
    </div> : tab === 'hot' ? <div className="bos-wb-form-actions"><Link className="bos-button bos-button-primary" href={`/messages?customer=${row.customer.id}`}>去回复客户</Link>
      <Link className="bos-button" href={`/products/quotes/new?customerId=${row.customer.id}`}>新建报价单</Link></div>
    : <>
      <div className="bos-outreach-form-grid">
        <label><span>回复质量</span><select className="bos-input" value={quality} onChange={e => setQuality(e.target.value)}>{Object.entries(QUALITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>修改原因</span><select className="bos-input" value={reason} onChange={e => setReason(e.target.value)}>{reasons.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>备注</span><input className="bos-input" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
      </div>
      <fieldset className="bos-outreach-signals"><legend>信号标签</legend>{SIGNAL_GROUPS.map(group => <div key={group.label}><span>{group.label}</span>
        {Object.entries(group.signals).map(([key, label]) => <label key={key} className="bos-wb-inline"><input type="checkbox" checked={signals.includes(key)} onChange={e => setSignals(e.target.checked ? [...signals, key] : signals.filter(s => s !== key))} />{label}</label>)}</div>)}</fieldset>
      <div className="bos-wb-form-actions">
        <Button variant="primary" disabled={busy} onClick={() => submit(row.id, `outreach/review/reply/${row.id}`, { quality, signals, reason, note })}>保存改判</Button>
        <Button disabled={busy} onClick={() => submit(row.id, `outreach/review/reply/${row.id}`, { confirm: true })}>判定无误</Button>
      </div>
    </>}
  </Card>;
}
