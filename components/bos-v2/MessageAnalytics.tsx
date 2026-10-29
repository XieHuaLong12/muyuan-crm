import Link from 'next/link';
import { Header, Table } from '@/components/ui/bos';
import { PeriodPicker } from '@/components/period-picker';
import type { MessageAnalytics as Data } from '@/services/message-analytics-service';
import { AnalyticsFilters } from './AnalyticsFilters';
import { Kpi, SectionHead, changeText, minutesText, number, percent, pointsText, toneOf } from './AnalyticsParts';

const BASE = '/command-center/messages';
/** Customer messages blue, ours orange (validated pair from the dataviz palette check). */
const LINE_COLORS = { inbound: '#2a78d6', outbound: '#eb6834' } as const;
/** Sequential blue ramp for the week grid, empty first. */
const RAMP = ['#f1f1f3', '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#1c5cab'];
const QUALITY_COLORS: Record<string, { fill: string; ink: string }> = {
  HIGH: { fill: '#1c5cab', ink: '#ffffff' }, ENGAGED: { fill: '#5598e7', ink: '#0b2a4f' }, LOW: { fill: '#b4b2a9', ink: '#1d1d1f' }, REJECT: { fill: '#e34948', ink: '#ffffff' },
};
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 消息分析 (docs/METRICS.md §消息分析): message volume, our response speed, customer replies and conversation states. */
export function MessageAnalytics({ data }: { data: Data }) {
  const { selected, filters } = data;
  const period: Record<string, string> = { range: selected.range, ...(selected.range === 'custom' ? { startDate: selected.startKey, endDate: selected.endKey } : {}) };
  const active = Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && !(key === 'clock' && value === 'company')));
  const here = (extra: Record<string, string>) => `${BASE}?${new URLSearchParams({ ...period, ...active, ...extra })}`;
  const clock: Record<string, string> = filters.clock === 'local' ? { clock: 'local' } : {};
  const speedChange = typeof data.speed.median === 'number' && Number.isFinite(data.speed.median) && typeof data.speed.previousMedian === 'number' && Number.isFinite(data.speed.previousMedian)
    ? data.speed.median - data.speed.previousMedian : null;

  return (
    <div className="business-cockpit bos-analytics">
      <Header title="消息分析" description={`按消息时间统计，${data.groupMinutes} 分钟内连发的算一组 · ${selected.startKey} — ${selected.endKey}，截至当前 · 与上一同长周期对比`}
        actions={<PeriodPicker basePath={BASE} selected={selected} keep={active} />} />
      <AnalyticsFilters basePath={BASE} keep={{ ...period, ...clock }} fields={[
        { name: 'owner', label: '负责人', value: filters.owner, options: data.options.owners.map(owner => ({ value: owner.id, label: owner.name })) },
        { name: 'grade', label: '客户等级', value: filters.grade, options: [...['A', 'B', 'C', 'D'].map(grade => ({ value: grade, label: grade })), { value: 'none', label: '未评级' }] },
        { name: 'country', label: '国家', value: filters.country, options: data.options.countries.map(country => ({ value: country, label: country })) },
        { name: 'channel', label: '发送方式', value: filters.channel, options: data.outbound.channels.map(channel => ({ value: channel.key, label: channel.label })) },
      ]} />

      <section className="cockpit-kpis analytics-kpis" aria-label="消息核心指标">
        <Kpi label="收到客户消息" value={number(data.inbound.groups)} unit="组" detail={`来自 ${number(data.inbound.customers)} 位客户`}
          compare={changeText(data.inbound.change) && `比上期 ${changeText(data.inbound.change)}`} tone={toneOf(data.inbound.change)} />
        <Kpi label="我们发出" value={number(data.outbound.groups)} unit="组" detail={`发给 ${number(data.outbound.customers)} 位客户`}
          compare={data.outbound.groups ? data.outbound.channels.map(channel => `${channel.label} ${percent(channel.share)}`).join(' · ') : null} />
        <Kpi label="客户回复率" value={percent(data.replyRate.rate)} detail={`我们发过消息的 ${number(data.replyRate.customers)} 位中，${number(data.replyRate.replied)} 位回复`}
          compare={[data.replyRate.byGrade.map(row => `${row.grade} ${percent(row.rate)}`).join(' · '), data.replyRate.previousRate === null ? '' : `上期 ${data.replyRate.previousRate}% · ${pointsText(data.replyRate.points)}`].filter(Boolean).join(' · ')} />
        <Kpi label="我们回复的速度" value={data.speed.median === null ? '—' : minutesText(data.speed.median)} detail={`中位数 · 5 分钟内回 ${percent(data.speed.within5)} · 1 小时内 ${percent(data.speed.within60)}`}
          compare={speedChange === null ? null : speedChange === 0 ? '与上期持平' : `比上期${speedChange > 0 ? '慢' : '快'} ${minutesText(Math.abs(speedChange))}`} tone={toneOf(speedChange, true)} />
        <Kpi label="现在待我们回复" value={number(data.waiting.total)} unit="位" alert={data.waiting.total > 0}
          detail={`超过 2 小时，其中 A / B ${data.waiting.good} 位 · 超过 24 小时 ${data.waiting.overDay} 位`}
          action={data.waiting.total ? { href: '/sales?queue=waiting', label: '去回复' } : null} />
      </section>

      <div className="analytics-grid">
        <section className="cockpit-card">
          <SectionHead title="每天收发的消息" detail={`${data.daily.label} · 鼠标移到点上看当${data.daily.view === 'day' ? '天' : data.daily.view === 'week' ? '周' : '月'}的组数`} />
          <Lines data={data} />
        </section>
        <section className="cockpit-card">
          <div className="cockpit-section-head">
            <div><h2>客户什么时候发消息</h2><p>收到的消息组 · 星期 × 小时</p></div>
            <div className="analytics-toggle" role="group" aria-label="时间">
              <Link href={here({ clock: 'company' })} aria-current={filters.clock === 'company' ? 'page' : undefined}>{data.clock.company}</Link>
              <Link href={here({ clock: 'local' })} aria-current={filters.clock === 'local' ? 'page' : undefined}>客户当地时间</Link>
            </div>
          </div>
          <Heatmap data={data} />
        </section>
      </div>

      <div className="analytics-grid">
        <section className="cockpit-card">
          <SectionHead title="我们回得多快" detail="客户发来消息后，我们第一次回复用了多久（客户连发几条算一次等待）" />
          {data.speed.decided ? (
            <>
              <div className="analytics-rows">
                {data.speed.buckets.map((bucket, index) => (
                  <div key={bucket.label} className="analytics-row" title={`${bucket.label}：${bucket.count} 次`}>
                    <span className="analytics-row-label">{bucket.label}</span>
                    <span className="analytics-track"><span className={index === data.speed.buckets.length - 1 ? 'is-urgent' : 'is-won'} style={{ width: `${bucket.count / Math.max(1, ...data.speed.buckets.map(row => row.count)) * 100}%` }} /></span>
                    <strong>{percent(bucket.share)}</strong>
                    <small>{number(bucket.count)} 次</small>
                  </div>
                ))}
              </div>
              <p className="analytics-text">{data.speed.byGrade.map(row => `${row.grade} 类中位 ${minutesText(row.median)}`).join(' · ')}{data.speed.pending ? ` · 还有 ${data.speed.pending} 次不到一天、还没回` : ''}</p>
            </>
          ) : <Empty />}
        </section>
        <section className="cockpit-card">
          <SectionHead title="客户回复的质量" detail="客户对我们消息的回复，按客户等级" />
          {data.quality.rows.some(row => row.total) ? (
            <div className="analytics-mix">
              {data.quality.rows.map(row => (
                <div key={row.grade} className="analytics-mix-row is-inline" title={`${row.grade} 类 ${row.total} 组回复：${row.parts.map(part => `${part.label} ${percent(part.share)}`).join(' · ')}`}>
                  <span className="analytics-row-label">{row.grade} 类</span>
                  <span className="analytics-mixbar is-tall">
                    {row.total ? row.parts.map(part => part.count ? (
                      <i key={part.key} style={{ width: `${part.share}%`, background: QUALITY_COLORS[part.key].fill, color: QUALITY_COLORS[part.key].ink }}>{(part.share ?? 0) >= 8 ? `${Math.round(part.share!)}%` : ''}</i>
                    ) : null) : <em>没有回复</em>}
                  </span>
                  <small>{number(row.total)} 组</small>
                </div>
              ))}
              <div className="cockpit-chart-legend analytics-legend">{data.quality.rows[0].parts.map(part => <span key={part.key}><i className="analytics-swatch" style={{ background: QUALITY_COLORS[part.key].fill }} />{part.label}</span>)}</div>
            </div>
          ) : <Empty />}
          <p className="cockpit-note">只统计客户对我们消息的回复{data.quality.since ? `（${data.quality.since} 话术功能上线后的新客户才有判定）` : ''}；对方的自动回复 {data.quality.auto} 组不计入。</p>
        </section>
      </div>

      <div className="analytics-grid">
        <section className="cockpit-card">
          <SectionHead title="会话现在的状态" detail={`这段时间有消息往来的 ${number(data.talked)} 位客户，现在在哪个阶段`} />
          <div className="analytics-states">
            {data.states.map(state => <div key={state.key}><span>{state.label}</span><strong>{number(state.count)}</strong></div>)}
          </div>
          <p className="analytics-text">本期破冰成功 <b>{number(data.icebreakWins)}</b> 位（回复了我们的破冰消息）。</p>
        </section>
        <section className="cockpit-card">
          <SectionHead title="模板消息" detail="BOS 发出的 WhatsApp 模板" />
          <div className="analytics-states">
            <div><span>发出模板</span><strong>{number(data.templates.sent)} <small>组</small></strong></div>
            <div><span>24 小时窗口外发出</span><strong>{number(data.templates.outsideWindow)} <small>组</small></strong></div>
            <div><span>24 小时内被回复</span><strong>{percent(data.templates.replyRate)}</strong></div>
            <div><span>发满 {data.templates.cap} 条仍没回复</span><strong>{number(data.templates.capped)} <small>位</small></strong></div>
          </div>
          <p className="cockpit-note">同一线索的模板消息最多 {data.templates.cap} 条；发满还没回复的客户只能用手机继续跟进。</p>
        </section>
      </div>

      <section className="cockpit-card">
        <SectionHead title="负责人" detail="按客户的负责人归属；回复速度和回复率的算法同上" />
        {data.owners.length ? (
          <Table caption="负责人消息统计" headings={['负责人', '发出', '收到', '会话客户', '回复中位', '5 分钟内回', '客户回复率', '待回复']}>
            {data.owners.map(owner => (
              <tr key={owner.id}>
                <td>{owner.id === 'pool' ? owner.name : <Link href={here({ owner: owner.id })}>{owner.name}</Link>}</td>
                <td>{number(owner.sent)}</td><td>{number(owner.received)}</td><td>{number(owner.customers)}</td>
                <td>{minutesText(owner.median)}</td><td>{percent(owner.within5)}</td><td>{percent(owner.replyRate)}</td><td>{owner.waiting}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty />}
      </section>

      <p className="cockpit-note analytics-footnote">
        消息按发送时间统计，不含发送失败和待发送的消息；同一方 {data.groupMinutes} 分钟内连发的算一组。客户回复率 = 这段时间我们发过消息的客户里，在我们发出后回复的比例（对方的自动回复不算）。回复速度从客户一轮消息的第一条算到我们的下一条；超过一天没回算「超过 24 小时或没回」，不到一天还没回的暂不计入。发送方式只筛选我们发出的消息。现在待我们回复按跟进队列「等待回复」的规则，只算新客户。
      </p>
    </div>
  );
}

function Empty() {
  return <p className="analytics-empty">这段时间没有符合条件的消息，换一个时间段或筛选看看。</p>;
}

/** Customer and our message groups per day (week, month), one scale. */
function Lines({ data }: { data: Data }) {
  const points = data.daily.points;
  if (!points.some(point => point.inbound || point.outbound)) return <Empty />;
  const width = 760, height = 230, left = 34, right = 14, top = 14, bottom = 30;
  const plotW = width - left - right, plotH = height - top - bottom;
  const max = Math.max(1, ...points.map(point => Math.max(point.inbound, point.outbound)));
  const x = (index: number) => left + (points.length === 1 ? plotW / 2 : index * plotW / (points.length - 1));
  const y = (value: number) => top + plotH - value / max * plotH;
  const path = (field: 'inbound' | 'outbound') => points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point[field]).toFixed(1)}`).join(' ');
  const labelIndices = [...new Set([0, Math.floor((points.length - 1) / 4), Math.floor((points.length - 1) / 2), Math.floor((points.length - 1) * 3 / 4), points.length - 1])];
  const inbound = points.reduce((sum, point) => sum + point.inbound, 0), outbound = points.reduce((sum, point) => sum + point.outbound, 0);
  return (
    <div className="cockpit-chart-wrap">
      <svg className="cockpit-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="每天客户发来与我们发出的消息组数折线图">
        {[0, .5, 1].map(fraction => (
          <g key={fraction}>
            <line x1={left} x2={width - right} y1={top + plotH * fraction} y2={top + plotH * fraction} className="cockpit-grid-line" />
            <text x={left - 8} y={top + plotH * fraction + 4} textAnchor="end" className="cockpit-axis-text">{Math.round(max * (1 - fraction))}</text>
          </g>
        ))}
        <path d={path('outbound')} fill="none" stroke={LINE_COLORS.outbound} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path('inbound')} fill="none" stroke={LINE_COLORS.inbound} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => (
          <g key={point.start}>
            <title>{`${point.label}：客户发来 ${point.inbound} 组 · 我们发出 ${point.outbound} 组`}</title>
            <rect x={x(index) - plotW / Math.max(1, points.length) / 2} y={top} width={plotW / Math.max(1, points.length)} height={plotH} fill="transparent" />
            <circle cx={x(index)} cy={y(point.inbound)} r={2.5} fill={LINE_COLORS.inbound} />
            <circle cx={x(index)} cy={y(point.outbound)} r={2.5} fill={LINE_COLORS.outbound} />
          </g>
        ))}
        {labelIndices.map(index => <text key={index} x={x(index)} y={height - 8} textAnchor="middle" className="cockpit-axis-text">{points[index]?.label}</text>)}
      </svg>
      <div className="cockpit-chart-legend analytics-legend">
        <span><i style={{ background: LINE_COLORS.inbound }} />客户发来 {number(inbound)} 组</span>
        <span><i style={{ background: LINE_COLORS.outbound }} />我们发出 {number(outbound)} 组</span>
      </div>
      <details className="cockpit-chart-data">
        <summary>查看图表数据</summary>
        <table><thead><tr><th>日期</th><th>客户发来</th><th>我们发出</th></tr></thead>
          <tbody>{points.map(point => <tr key={point.start}><td>{point.label}</td><td>{point.inbound}</td><td>{point.outbound}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

/** Week grid: rows Monday to Sunday, columns the 24 hours, darker = more customer message groups. */
function Heatmap({ data }: { data: Data }) {
  const { cells, busiest, weekend } = data.heatmap;
  const max = Math.max(...cells.flat());
  const zone = data.filters.clock === 'local' ? '客户当地时间' : data.clock.company;
  if (max === 0) return <Empty />;
  const shade = (value: number) => RAMP[value ? Math.max(1, Math.round(value / max * (RAMP.length - 1))) : 0];
  return (
    <>
      <div className="analytics-heatmap" role="img" aria-label={`客户发消息的时间分布，${zone}`}>
        <span />
        {Array.from({ length: 24 }, (_, hour) => <span key={hour} className="analytics-heatmap-hour">{hour % 3 === 0 ? hour : ''}</span>)}
        {cells.map((row, day) => [
          <span key={`d${day}`} className="analytics-heatmap-day">{WEEKDAYS[day]}</span>,
          ...row.map((value, hour) => <i key={`${day}-${hour}`} style={{ background: shade(value) }} title={`${WEEKDAYS[day]} ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00 ${zone}：${value} 组`} />),
        ])}
      </div>
      <div className="analytics-heatmap-scale" aria-hidden><span>少</span>{RAMP.map(color => <i key={color} style={{ background: color }} />)}<span>多</span></div>
      <p className="analytics-text">
        {busiest ? <>最活跃：{zone} <b>{busiest}</b>。</> : '消息还不够多，看不出规律。'}
        {weekend !== null && weekend !== 0 ? `周末每天比工作日${weekend < 0 ? '少' : '多'} ${Math.abs(weekend)}%。` : ''}
        {data.filters.clock === 'local' && data.clock.unknown ? `有 ${data.clock.unknown} 组消息的客户国家没有对应时区，未计入。` : ''}
      </p>
    </>
  );
}
