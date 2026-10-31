import Link from 'next/link';
import { ArrowRight, Info, Lightbulb } from 'lucide-react';
import { Header } from '@/components/ui/bos';
import { PeriodPicker } from '@/components/period-picker';
import { METRIC_NOTES } from '@/lib/metric-notes';
import type { CustomerAnalytics as Data } from '@/services/customer-analytics-service';
import { AnalyticsFilters } from './AnalyticsFilters';
import { AdLevels } from './AdLevels';
import { SectionHead, changeText, minutesText, money, number, percent, pointsText } from './AnalyticsParts';

const BASE = '/command-center/customers';
/** Grade colours as the chat avatars show them; validated for contrast as white text and as bars. */
const GRADE = { A: '#c2410c', B: '#1d5fc4' } as const;
const WAITING = '#e4e1d7';

/**
 * 客户分析 (docs/METRICS.md §客户分析). 新增线索 counts every lead; all else counts 有效客户 — A / B leads who answered
 * after our first message — and what they cost in ads.
 */
export function CustomerAnalytics({ data }: { data: Data }) {
  const { selected, filters, ads } = data;
  const period: Record<string, string> = { range: selected.range, ...(selected.range === 'custom' ? { startDate: selected.startKey, endDate: selected.endKey } : {}) };
  const active = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  // The customer list, for the same period and filters (it reads the same inquiry dates).
  const list = (extra: Record<string, string> = {}) => `/customers?${new URLSearchParams({ group: 'all', from: selected.startKey, to: selected.endKey, ...active, ...extra })}`;
  const here = (extra: Record<string, string>) => `${BASE}?${new URLSearchParams({ ...period, ...active, ...extra })}`;
  const flowRate = (part: number, whole: number) => percent(whole > 0 ? Math.round(part / whole * 100) : null);
  const spreadTotal = Math.max(1, data.total);
  const amount = (value: number | null) => value === null ? '—' : money(value, ads.currency);

  return (
    <div className="business-cockpit bos-analytics">
      <Header title="客户分析" description={`${selected.label} · ${selected.startKey} — ${selected.endKey}，截至当前 · 与上一个同长周期对比 · 按询盘日期归属`}
        actions={<PeriodPicker basePath={BASE} selected={selected} keep={active} />} />
      <div className="ca-toolbar">
        <AnalyticsFilters basePath={BASE} keep={period} fields={[
          { name: 'owner', label: '负责人', value: filters.owner, options: data.options.owners.map(owner => ({ value: owner.id, label: owner.name })) },
          { name: 'source', label: '来源', value: filters.source, options: data.options.sources.map(source => ({ value: source.key, label: source.label })) },
          { name: 'country', label: '国家', value: filters.country, options: data.options.countries.map(country => ({ value: country, label: country })) },
          { name: 'grade', label: '等级', value: filters.grade, emptyLabel: 'A + B', options: [{ value: 'A', label: '只看 A' }, { value: 'B', label: '只看 B' }] },
        ]} />
        <span className="ca-scope"><Info size={14} aria-hidden /><span><b>有效客户</b> = A / B 级，且我们发出第一条后客户回复了 · 只有「新增线索」是全部</span></span>
      </div>

      <section className="cockpit-card ca-flow-card" aria-label="从新增线索到成交">
        <ol className="ca-flow">
          <FlowStep label="新增线索 · 全部" value={data.total} detail={data.grades.filter(g => g.count).map(g => `${g.label} ${g.count}`).join(' · ') || '—'}
            compare={data.totalChange === null ? null : `比上期 ${changeText(data.totalChange)}（${number(data.previousTotal)}）`} up={(data.totalChange ?? 0) >= 0} />
          <FlowArrow rate={flowRate(data.ab.count, data.total)} />
          <FlowStep label={filters.grade ? `${filters.grade} 线索` : 'A / B 线索'} value={data.ab.count} detail={`A ${data.ab.A} · B ${data.ab.B} · 占新增 ${percent(data.ab.share)}`}
            compare={data.ab.previousShare === null ? null : `上期 ${data.ab.previousShare}% · ${pointsText(data.ab.points)}`} up={(data.ab.points ?? 0) >= 0} />
          <FlowArrow rate={flowRate(data.effective.count, data.ab.count)} />
          <FlowStep main label="有效客户" value={data.effective.count} detail={`A ${data.effective.A} · B ${data.effective.B} · 有效率 ${percent(data.effective.rate)}`}
            compare={`上期 ${number(data.effective.previous)} 位${data.effective.points === null ? '' : ` · 有效率 ${pointsText(data.effective.points)}`}`} up />
          <FlowArrow rate={flowRate(data.quoted, data.effective.count)} />
          <FlowStep label="已报价" value={data.quoted} detail={`占有效客户 ${percent(data.quotedRate)}`} compare={`上期 ${number(data.previousQuoted)}`} up={data.quoted >= data.previousQuoted} />
          <FlowArrow rate={flowRate(data.won, data.quoted)} />
          <FlowStep label="成交" value={data.won} detail={`成交率 ${percent(data.wonRate)}（÷ 有效）`} compare={`上期 ${number(data.previousWon)}`} up={data.won >= data.previousWon} />
        </ol>
        <div className="ca-spread" aria-label="新增线索的去向">
          <span className="ca-spread-bar" aria-hidden>
            {([[data.spread.effective, '#14432f'], [data.spread.waiting, '#8fbfa4'], [data.spread.other, '#dcd9cf'], [data.spread.ungraded, '#ecebe5']] as const)
              .map(([count, color], i) => count ? <i key={i} style={{ width: `${count / spreadTotal * 100}%`, background: color }} /> : null)}
          </span>
          <span className="ca-legend">
            <span><i style={{ background: '#14432f' }} />有效客户 {data.spread.effective}</span>
            <span><i style={{ background: '#8fbfa4' }} />{filters.grade || 'A / B'} 还没回复 {data.spread.waiting}</span>
            <span><i style={{ background: '#dcd9cf' }} />其余等级 {data.spread.other}</span>
            <span><i style={{ background: '#ecebe5', boxShadow: 'inset 0 0 0 1px #dcd9cf' }} />未评级 {data.spread.ungraded}</span>
            <span className="ca-legend-note">新增线索 {number(data.total)} 位的去向</span>
          </span>
        </div>
      </section>

      <div className="ca-stats">
        <Stat value={percent(data.firstContact.rate)} title="A / B 首联按时率" detail={`在首联期限内联系 · 用时中位数 ${minutesText(data.firstContact.medianMinutes)}`}
          action={data.firstContact.overdue ? { href: '/sales?queue=new', label: `超时未联系 ${data.firstContact.overdue} 位` } : null} />
        <Stat value={percent(data.effective.rate)} title="有效率" detail={`有效 ÷ ${filters.grade || 'A/B'} 线索 · 上期 ${percent(data.effective.previousRate)}`} />
        <Stat value={`${number(data.waitingForUs.count)} 位`} title="有效客户在等我们回复" detail={data.waitingForUs.overTwoHours ? `超过 2 小时 ${data.waitingForUs.overTwoHours} 位` : '都在 2 小时内'}
          action={data.waitingForUs.count ? { href: '/messages?filter=awaiting', label: '去消息页回复' } : null} alert={data.waitingForUs.overTwoHours > 0} />
      </div>

      <section className="ca-ads" aria-label="广告效果">
        <div className="ca-ads-hero">
          <span className="ca-ads-eyebrow">广告效果 · 按有效客户算</span>
          <span className="ca-ads-label">每个有效客户的广告花费</span>
          <strong>{amount(ads.perEffective)}</strong>
          {ads.previousPerEffective !== null && ads.perEffective !== null
            ? <span className="ca-ads-pill">上期 {amount(ads.previousPerEffective)} · {ads.perEffective <= ads.previousPerEffective ? '便宜了' : '贵了'} {Math.abs(Math.round((ads.perEffective - ads.previousPerEffective) / ads.previousPerEffective * 100))}%</span>
            : <span className="ca-ads-pill">{ads.spend ? '上期没有可比的数' : '这段时间没有广告花费'}</span>}
          <div className="ca-ads-grid">
            <div><span>花费</span><strong>{amount(ads.spend)}</strong><small>展示 {number(ads.impressions)} · 点击 {number(ads.clicks)}</small></div>
            <div><span>每个 {filters.grade || 'A / B'} 线索</span><strong>{amount(ads.perAb)}</strong><small>{number(ads.ab)} 位</small></div>
            <div><span>线索（平台 / CRM）</span><strong>{number(ads.platformLeads)} / {number(ads.leads)}</strong><small>CRM 归到广告 {number(ads.attributed)} 位 {filters.grade || 'A/B'}</small></div>
            <div><span>每个成交</span><strong>{amount(ads.perWon)}</strong><small>{number(ads.won)} 单</small></div>
          </div>
          <p>花费、展示、点击来自 Meta 广告接口，每天同步{ads.currency ? `，金额是 ${ads.currency}` : ''}；线索、有效、成交来自 CRM 和聊天记录。广告部分不受负责人、来源、国家筛选影响。
            {ads.otherCurrencies.length > 0 && ` 另有 ${ads.otherCurrencies.join('、')} 的花费没有算进来。`}</p>
        </div>
        <div className="cockpit-card ca-ads-detail">
          <AdLevels currency={ads.currency} campaigns={ads.campaigns} adsets={ads.adsets} ads={ads.ads} overall={ads.perEffective} />
          {(() => {
            const ranked = ads.campaigns.filter(c => c.perEffective !== null).sort((a, b) => a.perEffective! - b.perEffective!);
            if (ranked.length < 2) return null;
            const best = ranked[0], worst = ranked[ranked.length - 1];
            return <div className="ca-insight"><Lightbulb size={17} aria-hidden /><span>
              <b>{best.name}</b> 用了 {percent(best.spendShare)} 的钱，带来 {percent(best.effectiveShare)} 的有效客户，每个 {amount(best.perEffective)}，最便宜；
              <b>{worst.name}</b> 每个有效客户 {amount(worst.perEffective)}，可以考虑把它的预算挪给前者。</span></div>;
          })()}
        </div>
      </section>

      <div className="analytics-grid is-wide">
        <section className="cockpit-card">
          <SectionHead title={`每天的 ${filters.grade || 'A / B'} 线索，有几个成了有效客户`} detail={`${data.daily.label} · 按询盘日期 · 点柱子打开当${data.daily.view === 'day' ? '天' : data.daily.view === 'week' ? '周' : '月'}名单 · 底下是广告花费`} />
          <DailyBars data={data} list={list} amount={amount} />
        </section>
        <section className="cockpit-card ca-steps">
          <SectionHead title="有效客户现在在哪一步" detail={`${number(data.effective.count)} 位 · 按走到过的最远一步`} href={list()} action="打开名单" />
          {data.effective.count ? data.steps.map(step => (
            <div key={step.depth} className="ca-step">
              <span>{step.label}</span>
              <span className="ca-dots" aria-hidden>{Array.from({ length: Math.min(step.count, 24) }, (_, i) => <i key={i} />)}{step.count > 24 && <small>+{step.count - 24}</small>}</span>
              <strong>{number(step.count)}</strong>
            </div>
          )) : <Empty />}
          {data.lost > 0 && <p className="cockpit-note">其中 {data.lost} 位后来流失或判为无效。</p>}
          {data.stuck.count > 0 && <Link className="ca-stuck" href="/messages?filter=todo">
            <b>{number(data.stuck.count)} 位 {filters.grade || 'A / B'} 联系了还没回复</b>{data.stuck.overTwoDays ? `，其中 ${data.stuck.overTwoDays} 位超过 2 天` : ''}。去待处理跟进 <ArrowRight size={13} aria-hidden />
          </Link>}
        </section>
      </div>

      <div className="ca-tables">
        <Breakdown title="哪个来源带来有效客户" detail="有效率 = 有效 ÷ A/B" column="来源" rows={data.sources} link={key => here({ source: key })} />
        <Breakdown title="国家" detail="按有效客户数排" column="国家" rows={data.countries} link={key => here({ country: key })} />
        <Breakdown title="负责人" detail="谁把 A / B 聊成了有效客户" column="负责人" rows={data.owners} link={key => here({ owner: key })} />
      </div>

      <section className="cockpit-card">
        <SectionHead title={`这批有效客户 · ${number(data.effective.count)} 位`} detail={data.effective.count > data.people.length ? `按最后一条消息排，显示前 ${data.people.length} 位` : '按最后一条消息排'} href={list()} action="打开名单" />
        {data.people.length ? (
          <div className="ca-people" role="table" aria-label="有效客户名单">
            <div className="ca-people-row is-head" role="row"><span role="columnheader">客户</span><span role="columnheader">广告 · 国家</span><span role="columnheader">负责人</span><span role="columnheader">走到</span><span role="columnheader">最后消息</span></div>
            {data.people.map(person => (
              <Link key={person.id} href={`/messages?customer=${encodeURIComponent(person.id)}`} className="ca-people-row" role="row">
                <span role="cell" className="ca-person"><i style={{ background: GRADE[person.grade as 'A' | 'B'] ?? '#8e8d86' }}>{person.grade}</i><strong>{person.name}</strong></span>
                <span role="cell" className="ca-muted">{[person.from, person.country].filter(Boolean).join(' · ')}</span>
                <span role="cell">{person.owner}</span>
                <span role="cell"><em className="ca-chip">{person.step}</em></span>
                <span role="cell" className="ca-muted">{person.last ? `${dateTime(person.last.at, data.timezone)} · ${person.last.inbound ? '客户发来' : '我们发出'}` : '—'}</span>
              </Link>
            ))}
          </div>
        ) : <Empty />}
      </section>

      <p className="cockpit-note analytics-footnote">
        {METRIC_NOTES.newInquiries}有效客户：A / B 级，并且{METRIC_NOTES.qualified.replace(/^有效客户：/, '')}C、D 和未评级的客户回复了也不算。走到的步骤按到过的最远一步：需求确认 = 到过「已确认需求」；已报价 = 发过报价；成交 = 有成交记录。广告花费按 Meta 同步的日期归属，客户按第一次留资或点广告发消息归到广告。
      </p>
    </div>
  );
}

const dateTime = (iso: Date | string, timeZone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

function FlowStep({ label, value, detail, compare, up, main }: { label: string; value: number; detail: string; compare: string | null; up: boolean; main?: boolean }) {
  return (
    <li className={`ca-flow-step${main ? ' is-main' : ''}`}>
      <span className="ca-flow-label">{label}</span>
      <strong>{number(value)}<small>位</small></strong>
      <span className="ca-flow-detail">{detail}</span>
      {compare && <span className={`ca-flow-compare${up ? '' : ' is-down'}`}>{compare}</span>}
    </li>
  );
}
function FlowArrow({ rate }: { rate: string }) {
  return <li className="ca-flow-arrow" aria-label={`转化 ${rate}`}><span>{rate}</span><svg width="40" height="12" viewBox="0 0 40 12" aria-hidden><path d="M2 6h34M30 1l6 5-6 5" /></svg></li>;
}
function Stat({ value, title, detail, action, alert }: { value: string; title: string; detail: string; action?: { href: string; label: string } | null; alert?: boolean }) {
  return (
    <div className={`ca-stat${alert ? ' is-alert' : ''}`}>
      <strong>{value}</strong>
      <span><b>{title}</b><small>{detail}</small>{action && <Link href={action.href}>{action.label} →</Link>}</span>
    </div>
  );
}
function Empty() {
  return <p className="analytics-empty">这段时间没有符合条件的客户，换一个时间段或筛选看看。</p>;
}

type BreakdownRow = Data['sources'][number];
function Breakdown({ title, detail, column, rows, link }: { title: string; detail: string; column: string; rows: BreakdownRow[]; link: (key: string) => string }) {
  return (
    <section className="cockpit-card ca-breakdown">
      <SectionHead title={title} detail={detail} />
      {rows.length ? <div role="table" aria-label={title}>
        <div className="ca-breakdown-row is-head" role="row"><span role="columnheader">{column}</span><span role="columnheader">A/B</span><span role="columnheader">有效</span><span role="columnheader">有效率</span></div>
        {rows.map(row => (
          <div key={row.filterable ? row.key : `~${row.label}`} className="ca-breakdown-row" role="row">
            <span role="cell" className="ca-breakdown-name">{row.filterable ? <Link href={link(row.key)}>{row.label}</Link> : row.label}{row.won > 0 && <em className="ca-chip is-green">成交 {row.won}</em>}</span>
            <span role="cell" className="ca-muted">{number(row.ab)}</span>
            <strong role="cell">{number(row.effective)}</strong>
            <span role="cell" className="ca-rate"><span aria-hidden><i style={{ width: `${row.rate ?? 0}%`, background: (row.rate ?? 0) >= 50 ? '#14432f' : (row.rate ?? 0) >= 30 ? '#6fa587' : '#d9a06f' }} /></span>{percent(row.rate === null ? null : Math.round(row.rate))}</span>
          </div>
        ))}
      </div> : <Empty />}
    </section>
  );
}

/** Stacked bars per day (week, month): A effective at the bottom, then B effective, then A / B not yet answered. */
function DailyBars({ data, list, amount }: { data: Data; list: (extra?: Record<string, string>) => string; amount: (value: number | null) => string }) {
  const points = data.daily.points;
  const width = 760, height = 250, left = 34, right = 10, top = 24, bottom = 46;
  const plotW = width - left - right, plotH = height - top - bottom;
  const totals = points.map(point => point.A + point.B + point.waiting);
  const max = Math.max(1, ...totals);
  const slot = plotW / Math.max(1, points.length), bar = Math.max(2, Math.min(30, slot * .6));
  const every = Math.max(1, Math.ceil(points.length / 10));
  if (!totals.some(Boolean)) return <Empty />;
  return (
    <div className="cockpit-chart-wrap">
      <svg className="cockpit-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="每天 A/B 线索里有效客户的堆叠柱状图">
        {[0, .5, 1].map(fraction => (
          <g key={fraction}>
            <line x1={left} x2={width - right} y1={top + plotH * fraction} y2={top + plotH * fraction} className="cockpit-grid-line" />
            <text x={left - 8} y={top + plotH * fraction + 4} textAnchor="end" className="cockpit-axis-text">{Math.round(max * (1 - fraction))}</text>
          </g>
        ))}
        {points.map((point, index) => {
          const x = left + slot * index + (slot - bar) / 2;
          let y = top + plotH;
          const segments = ([['A', point.A, GRADE.A], ['B', point.B, GRADE.B], ['waiting', point.waiting, WAITING]] as const).map(([key, count, fill]) => {
            const h = count / max * plotH; y -= h;
            return count ? <rect key={key} x={x} y={y} width={bar} height={Math.max(0, h - (h > 3 ? 1.5 : 0))} rx={3} fill={fill} /> : null;
          });
          const label = index % every === 0 || index === points.length - 1;
          return (
            <a key={point.start} href={list({ from: point.start, to: point.end })} aria-label={`${point.label}：有效 ${point.A + point.B} / ${totals[index]}`}>
              <title>{`${point.label}：A/B ${totals[index]} 位 · 有效 A ${point.A} · B ${point.B} · 还没回复 ${point.waiting} · 广告花费 ${amount(point.spend)}`}</title>
              <rect x={left + slot * index} y={top} width={slot} height={plotH} fill="transparent" />
              {segments}
              {totals[index] > 0 && <text x={x + bar / 2} y={y - 6} textAnchor="middle" className="ca-bar-label">{point.A + point.B}/{totals[index]}</text>}
              {label && <text x={left + slot * index + slot / 2} y={height - 24} textAnchor="middle" className="cockpit-axis-text">{point.label}</text>}
              {label && point.spend > 0 && <text x={left + slot * index + slot / 2} y={height - 8} textAnchor="middle" className="ca-spend-label">{amount(point.spend)}</text>}
            </a>
          );
        })}
      </svg>
      <div className="ca-legend">
        <span><i style={{ background: GRADE.A }} />A 有效</span><span><i style={{ background: GRADE.B }} />B 有效</span><span><i style={{ background: WAITING }} />还没回复</span>
        <span className="ca-legend-note">柱顶：有效 / 线索</span>
      </div>
      <details className="cockpit-chart-data">
        <summary>查看图表数据</summary>
        <table><thead><tr><th>日期</th><th>A 有效</th><th>B 有效</th><th>还没回复</th><th>广告花费</th></tr></thead>
          <tbody>{points.map(point => <tr key={point.start}><td>{point.label}</td><td>{point.A}</td><td>{point.B}</td><td>{point.waiting}</td><td>{amount(point.spend)}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
