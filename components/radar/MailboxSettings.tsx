'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Table } from '@/components/ui/bos';
import { api, dateText } from '@/lib/client';
import type { radarSettings } from '@/services/radar-config-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Data = Jsonify<Awaited<ReturnType<typeof radarSettings>>>;
type Mailbox = Data['mailboxes'][number];
const today = () => new Date().toISOString().slice(0, 10);

/** 发信邮箱 and 禁发名单 on 设置 · 客户雷达. Tokens never reach the page; only the address and its state do. */
export function MailboxSettings({ data }: { data: Data }) {
  const router = useRouter();
  const [warmup, setWarmup] = useState(today());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ fromName: '', signature: '', warmupStartedAt: '', capOverride: '' });
  const [block, setBlock] = useState({ value: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run(task: () => Promise<string>) {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await task()); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const edit = (m: Mailbox) => { setEditing(m.id); setDraft({ fromName: m.fromName, signature: m.signature, warmupStartedAt: m.warmupStartedAt.slice(0, 10), capOverride: m.capOverride === null ? '' : String(m.capOverride) }); };

  return <>
    <Card className="bos-radar-form">
      <h2>发信邮箱</h2>
      <p className="bos-radar-hint">用新域名上的 Google Workspace 邮箱发开发信（不用公司主域名）。连接时会跳到 Google 授权页，用要连接的邮箱登录并同意「发送邮件、读取邮件」。每天的上限按预热开始日期自动计算：前两周只预热不发，第 3 周起每天 10、20、30、40 封逐周升档，上周退信率超标就不升档。</p>
      {!data.health.gmail && <p className="bos-radar-notice">尚未配置 GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET。在新域名的 Google Workspace 下建 Cloud 项目、OAuth 同意屏幕选「内部」、开启 Gmail API，授权回调地址填 https://你的域名/api/radar/mailboxes/callback。</p>}
      {message && <p className="bos-radar-message" role="status">{message}</p>}
      {error && <p className="bos-sales-error" role="alert">{error}</p>}
      <div className="bos-radar-connect">
        <label><span>预热开始日期</span><input className="bos-input" type="date" value={warmup} onChange={e => setWarmup(e.target.value)} /></label>
        <a className={`bos-button bos-button-primary${data.health.gmail ? '' : ' is-disabled'}`} aria-disabled={!data.health.gmail} href={data.health.gmail ? `/api/radar/mailboxes/connect?warmup=${warmup}` : undefined}><Plus size={15} aria-hidden="true" />连接 Google 邮箱</a>
      </div>
      {data.mailboxes.length ? <Table caption="发信邮箱" headings={['邮箱', '状态', '今天', '预热', '签名', '操作']}>
        {data.mailboxes.map(m => <tr key={m.id}>
          <td><strong>{m.address}</strong><small>{m.fromName || '—'}</small></td>
          <td>{!m.connected ? <Badge tone="warning">授权失效</Badge> : m.status === 'PAUSED' ? <Badge tone="warning">已暂停</Badge> : <Badge tone="green">正常</Badge>}{m.pausedReason && <small>{m.pausedReason}</small>}</td>
          <td>{m.sentToday} / {m.cap} 封{m.capOverride !== null && <small>手动上限 {m.capOverride}</small>}</td>
          <td>第 {m.week} 周<small>{dateText(m.warmupStartedAt)} 开始 · 近 {m.recent.sent} 封退信 {m.recent.bounced}</small></td>
          <td className="bos-radar-template-text"><span>{m.signature || '（还没写签名）'}</span></td>
          <td><div className="bos-radar-actions">
            <Button variant="ghost" onClick={() => editing === m.id ? setEditing(null) : edit(m)}>{editing === m.id ? '收起' : '编辑'}</Button>
            {m.connected && <Button variant="ghost" disabled={busy} onClick={() => run(async () => { await api(`radar/mailboxes/${m.id}`, 'PATCH', { status: m.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' }); return m.status === 'PAUSED' ? `${m.address} 已恢复` : `${m.address} 已暂停`; })}>{m.status === 'PAUSED' ? '恢复' : '暂停'}</Button>}
            {!m.connected && <a className="bos-button bos-button-ghost" href={`/api/radar/mailboxes/connect?warmup=${m.warmupStartedAt.slice(0, 10)}`}>重新连接</a>}
          </div></td>
        </tr>)}
      </Table> : <EmptyState title="还没有发信邮箱" description="域名和邮箱要在开发开始的同一周准备好，先预热两周再发信。" />}
      {editing && <div className="bos-radar-form-grid">
        <label><span>发件人显示名</span><input className="bos-input" value={draft.fromName} maxLength={80} placeholder="Jason" onChange={e => setDraft({ ...draft, fromName: e.target.value })} /></label>
        <label><span>预热开始日期</span><input className="bos-input" type="date" value={draft.warmupStartedAt} onChange={e => setDraft({ ...draft, warmupStartedAt: e.target.value })} /></label>
        <label><span>手动上限（可空，只能比自动值低）</span><input className="bos-input" type="number" min={0} value={draft.capOverride} onChange={e => setDraft({ ...draft, capOverride: e.target.value })} /></label>
        <label className="bos-radar-wide"><span>签名（附在每封信末尾）</span><textarea className="bos-input" rows={4} value={draft.signature} maxLength={1000} placeholder={'Jason · LVANJU\nhttps://www.lvanju.com · WhatsApp +86 …'} onChange={e => setDraft({ ...draft, signature: e.target.value })} /></label>
        <div><Button variant="primary" disabled={busy} onClick={() => run(async () => {
          await api(`radar/mailboxes/${editing}`, 'PATCH', { fromName: draft.fromName, signature: draft.signature, warmupStartedAt: draft.warmupStartedAt, capOverride: draft.capOverride === '' ? null : Number(draft.capOverride) });
          setEditing(null); return '发信邮箱已保存';
        })}>保存</Button></div>
      </div>}
    </Card>

    <Card className="bos-radar-form">
      <h2>禁发名单</h2>
      <p className="bos-radar-hint">退订、硬退信、已是客户、不感兴趣（180 天）、序列无回复（90 天）由系统自动加入；也可以手动加邮箱或整个域名。每封信发出前都会再查一次。</p>
      <div className="bos-radar-form-grid">
        <label><span>邮箱或域名</span><input className="bos-input" value={block.value} placeholder="buyer@shop.fr 或 shop.fr" onChange={e => setBlock({ ...block, value: e.target.value })} /></label>
        <label><span>备注</span><input className="bos-input" value={block.note} maxLength={300} onChange={e => setBlock({ ...block, note: e.target.value })} /></label>
        <div className="bos-radar-connect"><Button disabled={busy || !block.value.trim()} onClick={() => run(async () => { const r = await api<{ value: string }>('radar/suppressions', 'POST', block); setBlock({ value: '', note: '' }); return `${r.value} 已加入禁发名单`; })}><Plus size={15} />加入</Button></div>
      </div>
      {data.suppressions.length ? <Table caption="禁发名单" headings={['邮箱 / 域名', '原因', '到期', '备注', '']}>
        {data.suppressions.map(s => <tr key={s.id}>
          <td>{s.value}<small>{s.scope === 'DOMAIN' ? '整个域名' : '单个邮箱'}</small></td>
          <td>{s.reasonLabel}</td>
          <td>{s.expiresAt ? `${dateText(s.expiresAt)}${s.active ? '' : '（已到期）'}` : '永久'}</td>
          <td>{s.note || '—'}</td>
          <td><Button variant="ghost" aria-label={`移除 ${s.value}`} disabled={busy} onClick={() => run(async () => { await api(`radar/suppressions/${s.id}`, 'DELETE'); return `${s.value} 已移出禁发名单`; })}><Trash2 size={14} /></Button></td>
        </tr>)}
      </Table> : <p className="bos-radar-hint">禁发名单是空的。</p>}
    </Card>
  </>;
}
