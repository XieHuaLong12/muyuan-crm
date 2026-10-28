'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, ExternalLink, LayoutGrid, List, Mail, MessageCircle, Phone, Send } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Header, Search, Table } from '@/components/ui/bos';
import { api, dateText } from '@/lib/client';
import { PROSPECT_STATUSES, SCORE_LABELS, SCORE_MAX, VERIFY_STATUSES } from '@/lib/radar';
import type { listProspects } from '@/services/radar-prospect-service';
import { EnqueueDialog, type EnqueueResult, type Selection } from './EnqueueDialog';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
export type RadarData = Jsonify<Awaited<ReturnType<typeof listProspects>>>;
type Row = RadarData['rows'][number];

const LAYOUT_KEY = 'bos-radar-layout';
const VERIFY_TONE: Record<string, 'green' | 'warning' | 'neutral'> = { VALID: 'green', RISKY: 'warning', INVALID: 'warning', UNKNOWN: 'neutral', '': 'neutral' };
const verifyLabel = (status: string, bounced: boolean) => bounced ? '已退信' : VERIFY_STATUSES[status as keyof typeof VERIFY_STATUSES] ?? '未验证';

function GradeMark({ row }: { row: Row }) {
  if (!row.grade) return <span className="bos-radar-grade"><b aria-hidden="true">–</b>{row.scoreError ? '评分失败' : '待评分'}</span>;
  return <span className={`bos-radar-grade is-${row.grade.toLowerCase()}`}><b>{row.grade}</b>{row.score}<small>分</small></span>;
}

function Contact({ row }: { row: Row }) {
  if (row.email) return <div className="bos-radar-contact"><Mail size={14} aria-hidden="true" /><span>{row.email.address}</span>
    <Badge tone={row.email.bounced ? 'warning' : VERIFY_TONE[row.email.verifyStatus]}>{verifyLabel(row.email.verifyStatus, row.email.bounced)}</Badge>
    {row.emailCount > 1 && <small>另 {row.emailCount - 1} 个</small>}</div>;
  return <div className="bos-radar-contact"><Badge>无邮箱</Badge>
    {row.whatsapp && <><MessageCircle size={14} aria-hidden="true" /><span>{row.whatsapp}</span></>}
    {!row.whatsapp && row.phone && <><Phone size={14} aria-hidden="true" /><span>{row.phone}</span></>}</div>;
}

/** Whether a prospect can be put in the send queue: open, graded A or B, with a checked address. */
const mailable = (row: Row) => row.status === 'NEW' && row.sendable && (row.grade === 'A' || row.grade === 'B');

/**
 * 雷达客户: the companies the crawler found, scored, as a card wall or a list. 「发开发信」 and the list's selection open
 * the 加入发送队列 confirmation; the queue then sends slowly (docs/CUSTOMER_RADAR_COLD_EMAIL.md §6).
 */
export function RadarBoard({ data }: { data: RadarData }) {
  const router = useRouter();
  const path = usePathname();
  const [layout, setLayout] = useState<'cards' | 'list'>('cards');
  const [leaving, setLeaving] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [q, setQ] = useState(data.query.q);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => { try { if (window.localStorage.getItem(LAYOUT_KEY) === 'list') setLayout('list'); } catch { /* storage may be unavailable */ } }, []);
  function chooseLayout(next: 'cards' | 'list') { setLayout(next); try { window.localStorage.setItem(LAYOUT_KEY, next); } catch { /* keep in memory */ } }

  function go(change: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { view: data.query.view, country: data.query.country, grade: data.query.grade, email: data.query.email, q: data.query.q, today: data.query.today, ...change };
    for (const [key, value] of Object.entries(merged)) if (value && !(key === 'view' && value === 'OPEN')) params.set(key, String(value));
    if (!('page' in change)) params.delete('page');
    router.push(params.size ? `${path}?${params}` : path);
  }

  async function act(row: Row, body: Record<string, string>, done: string, leave = false) {
    setBusy(row.id); setError(''); setMessage('');
    try {
      await api(`radar/prospects/${row.id}`, 'PATCH', body);
      setMessage(done);
      if (leave) { setLeaving(ids => [...ids, row.id]); window.setTimeout(() => router.refresh(), 340); } else router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  function enqueued(result: EnqueueResult) {
    const ids = selection && 'ids' in selection ? selection.ids : [];
    setSelection(null); setPicked([]); setError('');
    const skipped = result.skipped.reduce((sum, s) => sum + s.count, 0);
    setMessage(`已加入发送队列 ${result.queued} 封${result.preparing ? `，其中 ${result.preparing} 封正在写个性化开头，写好后到「待复核」里通过` : ''}${skipped ? `；跳过 ${skipped} 家（${result.skipped.map(s => `${s.label} ${s.count}`).join('、')}）` : ''}`);
    if (result.queued && ids.length) { setLeaving(list => [...list, ...ids]); window.setTimeout(() => router.refresh(), 340); } else router.refresh();
  }

  const actions = (row: Row) => <div className="bos-radar-actions">
    {mailable(row) && <Button variant="primary" disabled={busy === row.id} onClick={() => setSelection({ ids: [row.id] })}><Send size={14} aria-hidden="true" />发开发信</Button>}
    {(row.status === 'NEW' || row.status === 'NO_EMAIL') && !row.sendable && <Button disabled={busy === row.id} onClick={() => act(row, { action: 'contacted' }, `${row.name} 已标为已联系`, data.query.view === 'OPEN')}>已联系</Button>}
    {['NEW', 'NO_EMAIL', 'CONTACTED'].includes(row.status) && <Button variant="ghost" disabled={busy === row.id} onClick={() => act(row, { action: 'exclude' }, `${row.name} 已排除`, data.query.view !== 'ALL')}>排除</Button>}
    {row.status === 'EXCLUDED' && !row.excludedReason.startsWith('已在 BOS') && <Button variant="ghost" disabled={busy === row.id} onClick={() => act(row, { action: 'restore' }, `${row.name} 已恢复`)}>恢复</Button>}
    {row.scoreError && !row.scoredAt && <Button variant="ghost" disabled={busy === row.id} onClick={() => act(row, { action: 'rescore' }, `${row.name} 将重新评分`)}>重新评分</Button>}
  </div>;

  const s = data.summary;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const missing = [!data.health.ingest && '爬虫密钥 RADAR_INGEST_SECRET', !data.health.deepSeek && 'DeepSeek（评分）', !data.health.verifier && '邮箱验证服务'].filter(Boolean);
  return <div className="bos-radar">
    <Header title="雷达客户" description={`今天新入库 ${s.todayNew} 家 · A 级 ${s.todayA} · B 级 ${s.todayB}${s.unscored ? ` · 待评分 ${s.unscored}` : ''}。按分数从高到低排列；没有有效邮箱的客户可以用电话等其他渠道联系后标「已联系」。`}
      actions={<>
        <Link className="bos-button bos-button-secondary" href="/radar/queue"><Send size={15} aria-hidden="true" />发送队列{s.queue ? ` ${s.queue}` : ''}</Link>
        <Button disabled={!s.todayA} onClick={() => setSelection({ preset: 'TODAY_A' })}>把今天的 A 级全部加入队列</Button>
        <div className="bos-radar-toggle" role="group" aria-label="显示方式">
          <button type="button" aria-pressed={layout === 'cards'} onClick={() => chooseLayout('cards')}><LayoutGrid size={14} aria-hidden="true" />卡片</button>
          <button type="button" aria-pressed={layout === 'list'} onClick={() => chooseLayout('list')}><List size={14} aria-hidden="true" />列表</button>
        </div></>} />
    {missing.length > 0 && <p className="bos-radar-notice" role="status"><AlertTriangle size={15} aria-hidden="true" />尚未配置：{missing.join('、')}。配置前对应环节不会运行，详见 <Link href="/settings/radar">设置 · 客户雷达</Link>。</p>}
    {message && <p className="bos-radar-message" role="status">{message}</p>}
    {error && <p className="bos-sales-error" role="alert">{error}</p>}

    <form className="bos-radar-filters" onSubmit={e => { e.preventDefault(); go({ q }); }}>
      <label><span>状态</span><select className="bos-input" value={data.query.view} onChange={e => go({ view: e.target.value })}>
        <option value="OPEN">待处理（新发现、无邮箱）</option><option value="ALL">全部</option>
        {Object.entries(PROSPECT_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}{s.byStatus[key as keyof typeof s.byStatus] ? `（${s.byStatus[key as keyof typeof s.byStatus]}）` : ''}</option>)}
      </select></label>
      <label><span>国家</span><select className="bos-input" value={data.query.country ?? ''} onChange={e => go({ country: e.target.value || undefined })}>
        <option value="">全部国家</option>{Object.entries(data.countries).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label><span>等级</span><select className="bos-input" value={data.query.grade ?? ''} onChange={e => go({ grade: e.target.value || undefined })}>
        <option value="">全部等级</option><option value="A">A 级（70 分以上）</option><option value="B">B 级（50–69 分）</option><option value="C">C 级（50 分以下）</option><option value="UNSCORED">待评分</option></select></label>
      <label><span>邮箱</span><select className="bos-input" value={data.query.email ?? ''} onChange={e => go({ email: e.target.value || undefined })}>
        <option value="">不限</option><option value="SENDABLE">有效或风险邮箱</option><option value="PENDING">待验证</option><option value="NONE">无邮箱</option></select></label>
      <div className="bos-radar-field"><span aria-hidden="true">搜索</span><Search label="搜索公司、城市、域名或主营产品" value={q} placeholder="公司、城市、域名、主营产品" onChange={e => setQ(e.target.value)} /></div>
      <label className="bos-radar-check"><input type="checkbox" checked={!!data.query.today} onChange={e => go({ today: e.target.checked ? '1' : undefined })} />只看今天新入库</label>
    </form>

    <div className="bos-radar-toolbar"><span>共 {data.total} 家{pages > 1 ? ` · 第 ${data.query.page} / ${pages} 页` : ''}</span>
      {layout === 'list' && picked.length > 0 && <span>已选 {picked.length} 家 <Button variant="primary" onClick={() => setSelection({ ids: picked })}><Send size={14} aria-hidden="true" />加入发送队列</Button>
        <Button variant="ghost" onClick={() => setPicked([])}>清除</Button></span>}</div>

    {!data.rows.length ? <Card><EmptyState title="这里还没有客户" description={data.total === 0 && data.query.view === 'OPEN' && !data.query.q ? '爬虫每天北京时间 06:00 按「关键词 × 城市」从 Google 地图找客户，入库后自动评分。先在设置里添加关键词和城市。' : '换个筛选条件试试。'}
      action={<Link className="bos-button bos-button-secondary" href="/settings/radar">关键词 × 城市</Link>} /></Card>
      : layout === 'cards' ? <div className="bos-radar-wall">{data.rows.map(row => <Card key={row.id} className={`bos-radar-card${leaving.includes(row.id) ? ' is-leaving' : ''}`}>
        <div className="bos-radar-card-head"><GradeMark row={row} />{row.status !== 'NEW' && <Badge tone={row.status === 'EXCLUDED' ? 'warning' : 'neutral'}>{row.statusLabel}</Badge>}</div>
        <h3>{row.name}</h3>
        <p className="bos-radar-meta">{[row.typeLabel, row.city, row.countryName].filter(Boolean).join(' · ')}{row.rating !== null && ` · ${row.rating} 分（${row.reviewCount ?? 0} 条评论）`}</p>
        {row.mainProducts && <p className="bos-radar-products">{row.mainProducts}</p>}
        {row.fact && <p className="bos-radar-fact">“{row.fact}”</p>}
        <Contact row={row} />
        {row.status === 'EXCLUDED' && row.excludedReason && <p className="bos-radar-meta">{row.excludedReason}</p>}
        {row.customerId && <p className="bos-radar-meta"><Link href={`/customers/${row.customerId}`}>在客户库中查看 →</Link></p>}
        {row.scoreError && !row.scoredAt && <p className="bos-radar-error">评分失败：{row.scoreError}</p>}
        <details><summary>评分与来源</summary>
          {row.scoreParts && <div className="bos-radar-parts">{(Object.keys(SCORE_MAX) as (keyof typeof SCORE_MAX)[]).map(key => <Part key={key} label={SCORE_LABELS[key]} value={row.scoreParts?.[key] ?? 0} max={SCORE_MAX[key]} />)}</div>}
          {row.aiReason && <p className="bos-radar-reason">{row.aiReason}</p>}
          <p className="bos-radar-reason">{row.keyword && `关键词「${row.keyword}」· `}{dateText(row.discoveredAt)} 入库{row.website && <> · <a href={row.website.startsWith('http') ? row.website : `https://${row.website}`} target="_blank" rel="noreferrer noopener">官网 <ExternalLink size={11} aria-hidden="true" /></a></>}</p>
        </details>
        {actions(row)}
      </Card>)}</div>
      : <Card><div className="bos-radar-table"><Table caption="雷达客户列表" headings={['选择', '等级', '公司', '类型', '国家 · 城市', '主营产品', '联系方式', '状态', '入库', '操作']}>
        {data.rows.map(row => <tr key={row.id}>
          <td><input type="checkbox" aria-label={`选择 ${row.name}`} disabled={!mailable(row)} checked={picked.includes(row.id)}
            onChange={e => setPicked(list => e.target.checked ? [...list, row.id] : list.filter(id => id !== row.id))} /></td>
          <td><GradeMark row={row} /></td>
          <td><strong>{row.name}</strong>{row.domain && <small>{row.domain}</small>}</td>
          <td>{row.typeLabel || '—'}</td>
          <td>{row.countryName}<small>{row.city || '—'}</small></td>
          <td>{row.mainProducts || '—'}</td>
          <td><Contact row={row} /></td>
          <td>{row.statusLabel}{row.status === 'EXCLUDED' && row.excludedReason && <small>{row.excludedReason}</small>}</td>
          <td>{dateText(row.discoveredAt)}</td>
          <td>{actions(row)}</td>
        </tr>)}
      </Table></div></Card>}

    {pages > 1 && <nav className="bos-radar-pager" aria-label="翻页">
      <Button disabled={data.query.page <= 1} onClick={() => go({ page: String(data.query.page - 1) })}>上一页</Button>
      <span>第 {data.query.page} / {pages} 页</span>
      <Button disabled={data.query.page >= pages} onClick={() => go({ page: String(data.query.page + 1) })}>下一页</Button>
    </nav>}
    <EnqueueDialog selection={selection} onClose={() => setSelection(null)} onDone={enqueued} />
  </div>;
}

function Part({ label, value, max }: { label: string; value: number; max: number }) {
  return <><span>{label}</span><i aria-hidden="true"><span style={{ width: `${Math.round(value / max * 100)}%` }} /></i><span>{value} / {max}</span></>;
}
