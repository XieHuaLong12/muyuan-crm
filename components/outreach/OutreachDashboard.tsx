'use client';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge, Card, EmptyState, Header, Table } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { CHANNELS, MATCH_TYPES, POSITION_LABELS, POSITIONS, QUALITIES, SCRIPT_LANGUAGES } from '@/lib/outreach';
import type { OutreachDashboard as Dashboard, scriptTouches } from '@/services/outreach-analytics-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Data = Jsonify<Dashboard>;
type Touches = Jsonify<Awaited<ReturnType<typeof scriptTouches>>>;

const pct = (value: number | null) => value === null ? '—' : `${value}%`;
const probability = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;
const dateTime = (iso: string, tz: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const SUGGESTION_TONE: Record<string, 'green' | 'warning' | 'neutral'> = { WIN: 'green', RETIRE: 'warning', CONTINUE: 'neutral', INSUFFICIENT: 'neutral' };

const FILTERS = [
  { key: 'position', label: '触达位置', options: POSITIONS.map(p => [p, POSITION_LABELS[p]] as const) },
  { key: 'grade', label: '客户等级', options: [['ALL', '全部'], ['A', 'A 类'], ['B', 'B 类'], ['C', 'C 类']] as const },
  { key: 'language', label: '语言', options: [['ALL', '全部'], ...Object.entries(SCRIPT_LANGUAGES)] as const },
  { key: 'range', label: '时间', options: [['30', '近 30 天'], ['90', '近 90 天'], ['180', '近 180 天'], ['all', '全部']] as const },
  { key: 'channel', label: '发送方式', options: [['ALL', '全部'], ['TEMPLATE', 'BOS 模板'], ['MANUAL', '手动消息（BOS 自由消息 + 手机）']] as const },
] as const;

/** 话术效果看板: overall, which script leads, and which to use per grade. Filters apply to every block. */
export function OutreachDashboard({ data }: { data: Data }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [touches, setTouches] = useState<Record<string, Touches | string>>({});
  const query = data.query as Record<string, string>;
  const setFilter = (key: string, value: string) => router.push(`/outreach?${new URLSearchParams({ ...query, [key]: value })}`);
  async function expand(id: string) {
    setOpen(current => current === id ? null : id);
    if (touches[id]) return;
    try { setTouches(t => ({ ...t, [id]: '' })); const r = await api<Touches>(`outreach/scripts/${id}/touches?${new URLSearchParams(query)}`); setTouches(t => ({ ...t, [id]: r })); }
    catch (e) { setTouches(t => ({ ...t, [id]: (e as Error).message })); }
  }
  const leader = data.ranking.find(r => r.suggestion === 'WIN');
  return <div className="bos-outreach">
    <Header title="话术效果" description={`同一触达位置内按 24 小时回复率比较，按客户等级分开算；不满 ${data.minSample} 条显示「数据不足」，系统只给建议，运营确认后才改话术状态。`}
      actions={<Link className="bos-button" href="/outreach/library">话术库</Link>} />
    <form className="bos-outreach-filters" aria-label="筛选" onSubmit={e => e.preventDefault()}>
      {FILTERS.map(f => <label key={f.key}><span>{f.label}</span>
        <select className="bos-input" value={query[f.key]} onChange={e => setFilter(f.key, e.target.value)}>{f.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}
    </form>

    <section className="bos-outreach-cards" aria-label="整体效果">
      <Card><span>发送数</span><strong>{data.cards.sent}</strong><small>{data.cards.pending ? `其中 ${data.cards.pending} 条未满 24 小时` : '全部已满 24 小时'}</small></Card>
      <Card><span>24 小时回复率</span><strong>{pct(data.cards.replyRate)}</strong><small>自动回复不算；迟到回复 {data.cards.late} 条单独计</small></Card>
      <Card><span>有效回复率</span><strong>{pct(data.cards.effectiveRate)}</strong><small>高意向 + 有效互动</small></Card>
      <Card><span>测试中话术</span><strong>{data.cards.testing} <small>条</small></strong><small>{data.cards.waiting ? `${data.cards.waiting} 条触达待判定或待复核` : '触达都已判定'}</small></Card>
    </section>

    <div className="bos-outreach-grid">
      <Card className="bos-outreach-ranking">
        <div className="bos-wb-section-head"><h2>{data.positionLabel} 话术排名</h2><small>只算按原样或轻改发出的话术</small></div>
        {data.ranking.length ? <Table caption="话术排名" headings={['话术编号', '发送数', '24h回复率', '有效回复率', '胜出概率', '系统建议']}>
          {data.ranking.map(row => <Fragment key={row.id}>
            <tr className={row.suggestion === 'WIN' ? 'is-recommended' : undefined}>
              <td><button type="button" className="bos-wb-link" aria-expanded={open === row.id} onClick={() => expand(row.id)}>{open === row.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<strong>{row.code}</strong></button>
                <small>{row.statusLabel} · {SCRIPT_LANGUAGES[row.language as keyof typeof SCRIPT_LANGUAGES] ?? row.language}</small></td>
              <td>{row.sent}{row.sent !== row.matured && <small>满 24 小时 {row.matured}</small>}</td>
              <td>{row.matured ? pct(row.replyRate) : '—'}<small>回复 {row.replied}{row.late ? ` · 迟到 ${row.late}` : ''}</small></td>
              <td>{row.matured ? pct(row.effectiveRate) : '—'}</td>
              <td>{probability(row.probability)}</td>
              <td><Badge tone={SUGGESTION_TONE[row.suggestion]}>{row.suggestionLabel}</Badge></td>
            </tr>
            {open === row.id && <tr className="bos-outreach-expanded"><td colSpan={6}><ScriptDetail content={row.content} note={row.versionNote} touches={touches[row.id]} timezone={data.timezone} /></td></tr>}
          </Fragment>)}
          <tr className="bos-outreach-nonstandard"><td><strong>非标准话术</strong><small>大幅改写、自由发挥、未登记模板</small></td><td>{data.nonStandard.sent}</td><td>{pct(data.nonStandard.replyRate)}</td><td>—</td><td>—</td><td><Badge>不参与比较</Badge></td></tr>
        </Table> : <EmptyState title="这个位置还没有话术" description="在话术库里登记话术后，系统会轮流分配给新线索。" action={<Link className="bos-button bos-button-primary" href="/outreach/library">去话术库</Link>} />}
      </Card>
      <Card className="bos-outreach-report">
        <h2>本周结论{data.report.live ? '（实时计算）' : '（周一自动生成）'}</h2>
        {data.report.lines.length ? <ul>{data.report.lines.map((line, i) => <li key={i} className={line.suggestion === 'WIN' ? 'is-win' : undefined}>{line.text}</li>)}</ul>
          : <p className="bos-wb-muted">还没有两条以上「测试中 / 胜出」的话术同时在测，暂无结论。</p>}
        <p className="bos-wb-muted">{leader ? `当前筛选下 ${leader.code} 达到胜出门槛。` : ''}运营确认后才改话术状态，系统不自动改。</p>
      </Card>
    </div>

    <Card className="bos-outreach-matrix">
      <div className="bos-wb-section-head"><h2>话术 × 客户等级回复率</h2><small>底色 = 该等级推荐话术；n = 满 24 小时的发送数；不满 {data.minSample} 条显示数据不足</small></div>
      {data.ranking.length ? <div className="bos-table-scroll"><table className="bos-table"><caption className="bos-sr-only">话术按客户等级的回复率</caption>
        <thead><tr><th scope="col">话术</th>{data.matrix.map(g => <th scope="col" key={g.grade}>{g.grade} 类{g.merged ? <small>（参考 A+B 合并数据）</small> : ''}</th>)}</tr></thead>
        <tbody>{data.ranking.map(row => <tr key={row.id}><th scope="row">{row.code}</th>
          {data.matrix.map(g => { const cell = g.cells.find(c => c.scriptId === row.id); return <td key={g.grade} className={g.recommended === row.id ? 'is-recommended' : undefined}>
            {!cell || !cell.matured ? '—' : cell.enough ? `${pct(cell.rate)} · n=${cell.matured}` : <span className="bos-wb-muted">数据不足 · n={cell.matured}</span>}
            {g.recommended === row.id && <small>{g.merged ? `合并数据 · 胜出概率 ${probability(g.mergedProbability)}` : '推荐'}</small>}
          </td>; })}</tr>)}</tbody></table></div> : <p className="bos-wb-muted">暂无数据。</p>}
    </Card>

    <div className="bos-outreach-grid is-even">
      <Card>
        <h2>非标准话术占比（近 7 天）</h2>
        {data.quality.nonStandard.length ? <ul className="bos-outreach-people">{data.quality.nonStandard.map(p => <li key={p.id}><span>{p.name}</span><span className={p.alert ? 'bos-danger-text' : ''}>{Math.round(p.share * 100)}%<small> · {p.total} 次触达</small></span></li>)}</ul>
          : <p className="bos-wb-muted">近 7 天没有已判定的触达。</p>}
        <p className="bos-wb-muted">超过 {Math.round(data.quality.nonStandardLimit * 100)}% 时提醒：要么话术库不好用，要么没按话术发。</p>
      </Card>
      <Card>
        <h2>本月 DeepSeek 改判率</h2>
        <p className="bos-outreach-big">{data.quality.overrideRate === null ? '—' : `${(data.quality.overrideRate * 100).toFixed(1)}%`}</p>
        <p className="bos-wb-muted">人工改判 {data.quality.overrideCorrected} 条 / AI 判定 {data.quality.overrideTotal} 条，不含语音、图片的人工判定。</p>
        {data.quality.overrideAlert && <p className="bos-outreach-alert"><AlertTriangle size={15} aria-hidden="true" />超过 {Math.round(data.quality.overrideLimit * 100)}%，请从修改记录里挑判错的例子校准提示词。</p>}
      </Card>
    </div>
  </div>;
}

function ScriptDetail({ content, note, touches, timezone }: { content: string; note: string; touches: Touches | string | undefined; timezone: string }) {
  return <div className="bos-outreach-detail">
    <p className="bos-outreach-script">{content}</p>
    {note && <p className="bos-wb-muted">版本说明：{note}</p>}
    {touches === undefined || touches === '' ? <p className="bos-wb-muted">正在读取触达记录…</p>
      : typeof touches === 'string' ? <p className="bos-sales-error">{touches}</p>
      : touches.touches.length ? <div className="bos-table-scroll"><table className="bos-table"><caption className="bos-sr-only">触达记录</caption>
        <thead><tr><th scope="col">客户</th><th scope="col">发送</th><th scope="col">方式</th><th scope="col">匹配</th><th scope="col">等级</th><th scope="col">24h 回复</th></tr></thead>
        <tbody>{touches.touches.map(t => <tr key={t.id}><td><Link href={`/messages?customer=${t.customer.id}`}>{t.customer.name}</Link><small>{t.customer.country}</small></td>
          <td>{dateTime(t.sentAt, timezone)}<small>{t.sender}</small></td><td>{CHANNELS[t.channel as keyof typeof CHANNELS] ?? t.channel}</td>
          <td>{MATCH_TYPES[t.matchType as keyof typeof MATCH_TYPES] ?? '—'}</td><td>{t.grade || '—'}</td>
          <td>{t.replied24h === null ? '未满 24 小时' : t.replied24h ? `是 · ${QUALITIES[t.replyQuality as keyof typeof QUALITIES] ?? ''}` : t.lateReply ? '迟到回复' : '否'}</td></tr>)}</tbody></table></div>
      : <p className="bos-wb-muted">筛选范围内没有你能看到的触达记录。</p>}
  </div>;
}
