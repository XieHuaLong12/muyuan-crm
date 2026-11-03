import Link from 'next/link';
import { ArrowRight, Info, Sparkles } from 'lucide-react';
import { Header } from '@/components/ui/bos';
import type { CountryCard as Data } from '@/services/country-card-service';
import { minutesText, money, number, percent } from './AnalyticsParts';

const BASE = '/command-center/countries';
/** Sequential greens, light to dark; text on the two darkest steps is white. Same ramp as 消息分析's heatmap. */
const RAMP = ['#eef3ef', '#d4e6da', '#b5d6c0', '#8fc0a2', '#5ea47f', '#2f7a57', '#14432f'];
const HATCH = 'repeating-linear-gradient(45deg,#ecebe5 0,#ecebe5 2px,#f8f7f3 2px,#f8f7f3 4px)';
const TAG_TONE: Record<string, string> = { entry: 'is-entry', send: 'is-send', day: 'is-day', follow: 'is-follow', speed: 'is-speed' };

type Map = Extract<Data, { empty: false }>['entryMap'];
type Cells = Map['rows'];

/**
 * 国家作战卡 (docs/METRICS.md §国家作战卡): one country, by 进线时间 — the patterns worth acting on, when leads and
 * answers come, how fast first contact must be, when to stop following up, which ads pay, what buyers ask for.
 */
export function CountryCard({ data }: { data: Data }) {
  const here = (patch: Record<string, string>) => `${BASE}?${new URLSearchParams({ country: data.country, weeks: String(data.query.weeks), clock: data.query.clock, ...patch })}`;
  const companyName = data.timezone === 'Asia/Shanghai' ? '北京' : data.timezone;
  const head = (
    <>
      <Header title={data.country ? `国家作战卡 · ${data.country}` : '国家作战卡'}
        description={`${data.periodLabel} · 按进线时间（线索第一次进入系统的时刻）${data.offset ? ` · ${data.country} ${data.offset}` : ''}`} />
      <div className="cc-toolbar">
        <nav className="cc-pills" aria-label="选国家">
          {data.countries.map(c => <Link key={c.name} href={here({ country: c.name })} aria-current={c.name === data.country ? 'page' : undefined}>{c.name}<small>{c.ab}</small></Link>)}
          {!data.countries.length && <span className="cc-muted">这段时间还没有填了国家的线索</span>}
        </nav>
        <nav className="analytics-toggle" aria-label="时间范围">
          {[4, 8, 12, 26].map(w => <Link key={w} href={here({ weeks: String(w) })} aria-current={data.query.weeks === w ? 'page' : undefined}>近 {w} 周</Link>)}
        </nav>
      </div>
    </>
  );
  if (data.empty) return <div className="business-cockpit bos-analytics cc-page">{head}<p className="analytics-empty">还没有可以分析的国家。</p></div>;
  const k = data.kpis;
  const cur = data.ads.currency ?? 'CNY';
  const yuan = (v: number | null) => v === null ? '—' : money(v, 'CNY');

  return (
    <div className="business-cockpit bos-analytics cc-page">
      {head}
      <section className="cc-kpis" aria-label="关键数字">
        <Kpi label="进线 · 全部" value={number(k.leads)} sub={`其中 ${k.exact} 位有准确钟点`} />
        <Kpi label="A / B 线索" value={number(k.ab)} sub={`占 ${percent(k.abShare)}`} />
        <Kpi main label="有效客户" value={number(k.effective)} sub={`有效率 ${percent(k.effectiveRate)}（÷ A/B）`} />
        <Kpi label="成交" value={number(k.won)} sub={`成交率 ${percent(k.wonRate)}（÷ 有效）`} />
        <Kpi label="每个有效客户" value={k.perEffective === null ? '—' : money(k.perEffective, cur)} sub={data.ads.synced ? '这个国家的广告花费 ÷ 有效' : 'Meta 按国家的花费还没同步'} />
        <Kpi label="首联用时" value={minutesText(k.contactMedian)} sub="A / B 中位数" />
        <Kpi label="工作时间外进线" value={percent(k.offShare)} sub={`你的工作时间 ${data.workText}`} alert={(k.offShare ?? 0) >= 40} />
      </section>

      <section className="cockpit-card cc-findings" aria-label="最值得改的地方">
        <div className="cc-findings-head">
          <span className="cc-spark" aria-hidden><Sparkles size={17} /></span>
          <div><h2>{data.country}这 {data.query.weeks} 周最值得改的地方</h2><p>按数据自动找出；每条都写了依据，每组至少 {data.minGroup} 位客户才下结论</p></div>
          <Link className="cc-primary" href="/command-center/plan">排进今天的计划 <ArrowRight size={14} aria-hidden /></Link>
        </div>
        {data.findings.length ? <div className="cc-finding-grid">
          {data.findings.map(f => <article key={f.title} className="cc-finding">
            <span className={`cc-tag ${TAG_TONE[f.tone]}`}>{f.tag}</span>
            <strong>{f.title}</strong>
            <p>{f.body}</p>
            <p className="cc-finding-action"><b>建议：</b>{f.action}</p>
            <small>{f.basis}</small>
          </article>)}
        </div> : <p className="cc-muted">样本还不够：每组不到 {data.minGroup} 位客户时不下结论。可以把时间范围拉长到近 12 周或 26 周再看。</p>}
      </section>

      <section className="cockpit-card cc-maps" aria-label="时间热力图">
        <div className="cc-section-head">
          <div><h2>什么时候进线的客户质量高，什么时候发消息客户爱回</h2>
            <p>星期 × 小时 · 绿色越深越好 · 斜线格子不到 3 位，先不看 · 白格是你不在线的时间（{data.workText}，{companyName}）</p></div>
          {data.zone && <nav className="analytics-toggle" aria-label="按谁的时间看">
            <Link href={here({ clock: 'company' })} aria-current={data.query.clock === 'company' ? 'page' : undefined}>{companyName}时间</Link>
            <Link href={here({ clock: 'local' })} aria-current={data.query.clock === 'local' ? 'page' : undefined}>{data.country}时间</Link>
          </nav>}
        </div>
        <div className="cc-map-grid">
          <HeatMap title="进线时间 × A / B 占比" hint={`这个时间进来的线索，A / B 占多少 · ${data.entryMap.n} 位有准确钟点${data.entryMap.skipped ? `（${data.entryMap.skipped} 位只有日期，没算）` : ''}`}
            rows={data.entryMap.rows} low="A/B 少" high="A/B 多" unit="进线" showOff={false} />
          <HeatMap title="我们发首条的时间 × 3 天内回复率" hint={`首条在这个时间发出，3 天内客户回复的比例 · ${data.sendMap.n} 次 · 平均 ${percent(data.sendMap.overall)}`}
            rows={data.sendMap.rows} low="回得少" high="回得多" unit="首条" showOff />
        </div>
        {data.sendMap.best && <p className="cc-read">在你的工作时间里，<b>北京 {data.sendMap.best.start}:00–{data.sendMap.best.end}:00</b>{data.zone ? `（${data.country} ${data.sendMap.best.localStart}–${data.sendMap.best.localEnd}）` : ''}发出的首条回复率最高：{data.sendMap.best.rate}%（{data.sendMap.best.n} 次）。</p>}
      </section>

      <div className="analytics-grid">
        <section className="cockpit-card cc-speed" aria-label="首联速度">
          <div className="cc-section-head"><div><h2>首联越快，越容易变成有效客户</h2><p>A / B 线索 · 从进线到我们第一条消息的用时 · 柱子下面是人数</p></div></div>
          <div className="cc-columns">
            {data.speed.map((s, i) => <div key={s.key} className="cc-column">
              <strong>{percent(s.rate)}</strong>
              <span className="cc-column-bar" style={{ height: `${Math.max(4, (s.rate ?? 0) * 1.9)}px`, background: i < 2 ? '#14432f' : i < 3 ? '#5ea47f' : '#d9a06f' }} />
              <small>{s.label}</small><small className="cc-muted">{s.n} 位</small>
            </div>)}
          </div>
          {data.offEntry.n > 0 && <p className="cc-warn">工作时间外进线的 A / B 有 {data.offEntry.n} 位，中位要等 {minutesText(data.offEntry.medianWait)} 才收到第一条，有效率 {percent(data.offEntry.effectiveRate)}；工作时间内进线的是 {percent(data.offEntry.inRate)}。</p>}
        </section>

        <section className="cockpit-card cc-follow" aria-label="跟进次数">
          <div className="cc-section-head"><div><h2>跟进到第几次就该停</h2><p>第 N 次主动发消息后 3 天内回复的比例 · 1 小时内连发算一次 · 客户回了就重新数</p></div></div>
          <div className="cc-bars">
            {data.follow.map((f, i) => <div key={f.label} className="cc-bar-row">
              <span>{f.label}</span>
              <span className="cc-track"><i style={{ width: `${Math.min(100, (f.rate ?? 0) / Math.max(1, ...data.follow.map(x => x.rate ?? 0)) * 100)}%`, background: i < 2 ? '#14432f' : i < 3 ? '#5ea47f' : '#d9a06f' }} /></span>
              <strong>{percent(f.rate)}</strong><small>{f.n} 次</small>
            </div>)}
          </div>
          <div className="cc-facts">
            <div><span>送达到已读</span><strong>{minutesText(data.read.medianToRead)}</strong><small>中位数 · {data.read.withReceipt} 条有回执</small></div>
            <div><span>已读不回</span><strong>{percent(data.read.readNoReply)}</strong><small>首条 · {data.read.readClosed} 条</small></div>
            <div><span>已读后回复</span><strong>{minutesText(data.read.medianReadToReply)}</strong><small>中位数</small></div>
          </div>
        </section>
      </div>

      <div className="analytics-grid is-wide">
        <section className="cockpit-card cc-ads" aria-label="广告">
          <div className="cc-section-head"><div><h2>{data.country}的广告：哪条素材值钱</h2>
            <p>按有效客户排 · 花费来自 Meta 按国家、按广告的每日数据{data.ads.overallPerEffective !== null ? ` · 平均每个有效 ${money(data.ads.overallPerEffective, cur)}` : ''}</p></div>
            {!data.ads.synced && <span className="cc-chip is-blue">花费未同步</span>}</div>
          {data.ads.list.length ? <div className="cc-table" role="table">
            <div className="cc-table-row is-head" role="row"><span>素材</span><span>A/B</span><span>有效</span><span>有效率</span><span>每个有效</span><span>成交</span></div>
            {data.ads.list.map(a => <div key={a.key} className="cc-table-row" role="row">
              <span title={a.name}>{a.name}</span><span>{a.ab}</span><strong>{a.effective}</strong><span>{percent(a.rate)}</span>
              <span className={costTone(a.perEffective, data.ads.overallPerEffective)}>{a.perEffective === null ? '—' : money(a.perEffective, cur)}</span><span>{a.won}</span>
            </div>)}
          </div> : <p className="cc-muted">这个国家的 A / B 还没有能对上广告的。</p>}
          <div className="cc-slots">
            <strong>按投放时段（{data.country}当地时间）：花费对比有效客户</strong>
            {data.ads.hourlySynced ? <>
              {data.ads.slots.map(s => <div key={s.label} className="cc-slot">
                <span>{s.label}</span>
                <span className="cc-slot-bars"><i style={{ width: `${s.spendShare ?? 0}%`, background: '#d9a06f' }} /><i style={{ width: `${s.effectiveShare ?? 0}%`, background: '#14432f' }} /></span>
                <span className={costTone(s.perEffective, data.ads.overallPerEffective)}>{s.perEffective === null ? '—' : money(s.perEffective, cur)}</span>
              </div>)}
              <small className="cc-muted">上条：花费占比 · 下条：有效客户占比 · 右边：每个有效客户。按小时的花费按每条广告在这个国家的花费占比分摊。</small>
            </> : <p className="cc-muted">Meta 按小时的花费还没同步（下次广告同步后出现）。</p>}
          </div>
        </section>

        <section className="cockpit-card cc-needs" aria-label="客户要什么">
          <div className="cc-section-head"><div><h2>{data.country}客户要什么</h2><p>来自需求画像，只算你确认过的 · {data.profiled} 位有效客户确认过需求</p></div></div>
          {data.needs.length ? data.needs.map(n => <div key={n.field} className="cc-need">
            <span>{n.label}</span>
            <div className="cc-need-bar">{n.parts.map((p, i) => <i key={p.value} title={`${p.value} · ${p.n} 位 · ${p.share}%`}
              style={{ flex: Math.max(p.share, 1), background: p.value === '其他' ? '#dcd9cf' : ['#14432f', '#2f7a57', '#8fc0a2'][i] ?? '#b5d6c0', color: p.value === '其他' || i === 2 ? '#17221b' : '#fff' }}>{p.share >= 14 ? `${p.value} ${p.share}%` : ''}</i>)}</div>
          </div>) : <p className="cc-muted">还没有确认过的需求。在聊天右侧的「需求画像」里点 ✓，这里就会汇总。</p>}
        </section>
      </div>

      <div className="cc-three">
        <section className="cockpit-card" aria-label="成交周期">
          <h2 className="cc-h3">成交要多久、首单多少</h2>
          <div className="cc-facts is-two">
            <div><span>进线到成交</span><strong>{data.cycle.medianDays === null ? '—' : `${data.cycle.medianDays} 天`}</strong><small>中位数 · 近 12 个月 {data.cycle.deals} 单</small></div>
            <div><span>首单金额</span><strong>{yuan(data.cycle.medianFirstAmount)}</strong><small>中位数，折人民币</small></div>
          </div>
          <p className="cc-read">{data.cycle.profitPerEffective !== null
            ? <>近 12 个月，每个有效客户平均带来 <b>{yuan(data.cycle.profitPerEffective)}</b> 毛利{k.perEffective !== null && cur === 'CNY' ? <>；现在每个有效客户花 {money(k.perEffective, cur)} 广告费</> : null}。</>
            : '还没有成交，算不出每个有效客户值多少。'}</p>
        </section>
        <section className="cockpit-card" aria-label="流失原因">
          <h2 className="cc-h3">丢在哪、为什么</h2>
          {data.lost.total ? <div className="cc-bars">{data.lost.rows.map((r, i) => <div key={r.reason} className="cc-bar-row is-short">
            <span>{r.reason}</span><span className="cc-track"><i style={{ width: `${r.share ?? 0}%`, background: i === 0 ? '#9a5220' : '#d9a06f' }} /></span><strong>{percent(r.share)}</strong>
          </div>)}</div> : <p className="cc-muted">近 12 个月还没有标为已流失 / 暂不需要的客户。</p>}
          <small className="cc-muted">改阶段为「已流失 / 暂不需要」时选的原因，近 12 个月 {data.lost.total} 位</small>
        </section>
        <section className="cockpit-card" aria-label="节假日">
          <h2 className="cc-h3">{data.country}接下来的节假日</h2>
          {data.holidays.length ? <ul className="cc-holidays">{data.holidays.map(h => <li key={h.date}><b>{h.label}</b><span><strong>{h.name}</strong><small>{h.note}</small></span></li>)}</ul>
            : <p className="cc-muted">这个国家的节假日还没收录。</p>}
        </section>
      </div>

      <p className="cc-foot"><Info size={13} aria-hidden /> 进线时间 = 线索第一次进入系统的时刻（广告表单的提交时间、客户第一条 WhatsApp、手动录入），按客户国家换算当地时间，冬夏令时自动处理；只有日期没有钟点的不进热力图。相关不等于因果：改规则前，可以先拿一部分客户试一周再看。</p>
    </div>
  );
}

function Kpi({ label, value, sub, main, alert }: { label: string; value: string; sub: string; main?: boolean; alert?: boolean }) {
  return <div className={`cc-kpi${main ? ' is-main' : ''}${alert ? ' is-alert' : ''}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

const costTone = (value: number | null, overall: number | null) => `cc-cost${value === null || overall === null ? '' : value <= overall ? ' is-good' : value > overall * 1.3 ? ' is-high' : ''}`;

function HeatMap({ title, hint, rows, low, high, unit, showOff }: { title: string; hint: string; rows: Cells; low: string; high: string; unit: string; showOff: boolean }) {
  const rates = rows.flatMap(r => r.cells.flatMap(c => c.rate === null || (showOff && c.off) ? [] : [c.rate]));
  const lo = rates.length ? Math.min(...rates) : 0, hi = rates.length ? Math.max(...rates) : 1;
  const shade = (rate: number) => RAMP[Math.round(((rate - lo) / Math.max(1, hi - lo)) * (RAMP.length - 1))];
  return (
    <div className="cc-map">
      <strong>{title}</strong>
      <small>{hint}</small>
      <div className="analytics-heatmap cc-heat" role="img" aria-label={`${title}：星期 × 小时`}>
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="analytics-heatmap-hour">{h % 3 === 0 ? h : ''}</span>)}
        <span />
        {rows[0].cells.map((c, h) => <i key={`band-${h}`} className={`cc-band${c.off ? '' : ' is-on'}`} />)}
        {rows.map(r => [
          <span key={r.day} className="analytics-heatmap-day">{r.day}</span>,
          ...r.cells.map((c, h) => {
            const label = `${r.day} ${h}:00：${c.n} 次${unit}${c.rate === null ? '，不到 3 位先不看' : ` · ${c.rate}%`}${c.off ? ' · 你不在线' : ''}`;
            const style = showOff && c.off ? { background: '#fff', boxShadow: 'inset 0 0 0 1px #efede6' }
              : c.rate === null ? { background: c.n ? HATCH : '#f8f7f3' } : { background: shade(c.rate) };
            return <i key={`${r.day}-${h}`} title={label} style={style} />;
          }),
        ])}
      </div>
      <div className="analytics-heatmap-scale"><span>{low}</span>{RAMP.slice(0, 6).map(c => <i key={c} style={{ background: c }} />)}<span>{high}</span>
        <i style={{ background: HATCH, marginLeft: 12 }} /><span>不到 3 位</span></div>
    </div>
  );
}
