import Link from 'next/link';
import { Info } from 'lucide-react';
import { Header } from '@/components/ui/bos';
import { PeriodPicker } from '@/components/period-picker';
import type { MessageAnalytics as Data } from '@/services/message-analytics-service';
import { AnalyticsFilters } from './AnalyticsFilters';
import { SectionHead, changeText, minutesText, number, percent } from './AnalyticsParts';

const BASE = '/command-center/messages';
/** Customer messages dark green, ours amber; the week grid a green ramp, empty first. */
const LINE = { inbound: '#14432f', outbound: '#c47a3c' } as const;
const RAMP = ['#f1efe8', '#d4e6da', '#b5d6c0', '#9cc8ad', '#74b08f', '#4f9a74', '#2f7a57', '#14432f'];
const SPEED_COLORS = ['#14432f', '#4f9a74', '#9cc8ad', '#d9a06f', '#c47a3c', '#9a5220'];
const STATE_COLORS: Record<string, string> = { US: '#c2410c', THEM: '#1d5fc4', QUIET: '#9aa79d' };
const GRADE: Record<string, string> = { A: '#c2410c', B: '#1d5fc4' };
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 消息分析 (docs/METRICS.md §消息分析): the chats with 有效客户 only — volume, our speed, when they write, who waits. */
export function MessageAnalytics({ data }: { data: Data }) {
  const { selected, filters } = data;
  const period: Record<string, string> = { range: selected.range, ...(selected.range === 'custom' ? { startDate: selected.startKey, endDate: selected.endKey } : {}) };
  const active = Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && !(key === 'clock' && value === 'company')));
  const here = (extra: Record<string, string>) => `${BASE}?${new URLSearchParams({ ...period, ...active, ...extra })}`;
  const clock: Record<string, string> = filters.clock === 'local' ? { clock: 'local' } : {};
  const finite = (value: number | null) => typeof value === 'number' && Number.isFinite(value);
  const speedChange = finite(data.speed.median) && finite(data.speed.previousMedian) ? data.speed.median! - data.speed.previousMedian! : null;
  const waited = (minutes: number) => minutes < 60 ? `${Math.max(1, minutes)} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${Math.floor(minutes / 1440)} 天`;

  return (
    <div className="business-cockpit bos-analytics">
      <Header title="消息分析" description={`${selected.label} · ${selected.startKey} — ${selected.endKey}，截至当前 · 与上一个同长周期对比 · ${data.groupMinutes} 分钟内连发的算一组`}
        actions={<PeriodPicker basePath={BASE} selected={selected} keep={active} />} />
      <div className="ca-toolbar">
        <AnalyticsFilters basePath={BASE} keep={{ ...period, ...clock }} fields={[
          { name: 'owner', label: '负责人', value: filters.owner, options: data.options.owners.map(owner => ({ value: owner.id, label: owner.name })) },
          { name: 'grade', label: '等级', value: filters.grade, emptyLabel: 'A + B', options: [{ value: 'A', label: '只看 A' }, { value: 'B', label: '只看 B' }] },
          { name: 'country', label: '国家', value: filters.country, options: data.options.countries.map(country => ({ value: country, label: country })) },
          { name: 'channel', label: '发送方式', value: filters.channel, options: data.outbound.channels.map(channel => ({ value: channel.key, label: channel.label })) },
        ]} />
        <span className="ca-scope"><Info size={14} aria-hidden /><span>只算和 <b>有效客户</b> 的聊天（A / B 且回复了）· 正在跟进的 {number(data.effectiveCustomers)} 位</span></span>
      </div>

      <section className="ma-top">
        <div className={`ma-waiting${data.waiting.total ? '' : ' is-calm'}`}>
          <div className="ma-waiting-head">
            <strong>{number(data.waiting.total)}<small>位</small></strong>
            <span><b>有效客户在等我们回复</b><small>{data.waiting.total ? `超过 2 小时 ${data.waiting.late} 位${data.waiting.lateA ? `，其中 A 级 ${data.waiting.lateA} 位` : ''}` : '现在没有人在等，保持住'}</small></span>
          </div>
          {data.waiting.people.length > 0 && <ul>
            {data.waiting.people.map(person => (
              <li key={person.id}><Link href={`/messages?customer=${encodeURIComponent(person.id)}`}>
                <i style={{ background: GRADE[person.grade] ?? '#8e8d86' }}>{person.grade}</i><strong>{person.name}</strong>
                <span className={person.waitedMinutes > 120 ? 'is-late' : undefined}>等了 {waited(person.waitedMinutes)}</span>
              </Link></li>
            ))}
          </ul>}
          {data.waiting.total > 0 && <Link className="ma-waiting-go" href="/messages?filter=awaiting">去消息页回复 →</Link>}
        </div>
        <div className="ma-stats">
          <Stat title="我们回复的速度" value={data.speed.median === null ? '—' : minutesText(data.speed.median)} detail={`中位数 · 5 分钟内 ${percent(data.speed.within5)} · 1 小时内 ${percent(data.speed.within60)}`}
            compare={speedChange === null ? null : speedChange === 0 ? '与上期持平' : `比上期${speedChange > 0 ? '慢' : '快'} ${minutesText(Math.abs(speedChange))}`} good={speedChange === null || speedChange <= 0}
            spark={data.daily.points.map(point => point.speed)} color={LINE.inbound} />
          <Stat title="有效客户发来" value={`${number(data.inbound.groups)} 组`} detail={`来自 ${number(data.inbound.customers)} 位${data.inbound.customers ? ` · 平均每位 ${Math.round(data.inbound.groups / data.inbound.customers * 10) / 10} 组` : ''}`}
            compare={changeText(data.inbound.change) && `比上期 ${changeText(data.inbound.change)}`} good={(data.inbound.change ?? 0) >= 0} spark={data.daily.points.map(point => point.inbound)} color={LINE.inbound} />
          <Stat title="我们发给有效客户" value={`${number(data.outbound.groups)} 组`} detail={data.outbound.groups ? data.outbound.channels.filter(c => c.groups).map(c => `${c.label} ${percent(c.share)}`).join(' · ') : '这段时间没有发出'}
            compare={changeText(data.outbound.change) && `比上期 ${changeText(data.outbound.change)}`} good={(data.outbound.change ?? 0) >= 0} spark={data.daily.points.map(point => point.outbound)} color={LINE.outbound} />
          <Stat title="3 天没动静" value={`${number(data.states.find(s => s.key === 'QUIET')!.count)} 位`} detail="最后一条消息超过 3 天，可能凉了"
            compare={data.states.find(s => s.key === 'QUIET')!.count ? '去待处理跟进 →' : null} good={false} href="/messages?filter=todo" />
        </div>
      </section>

      <div className="analytics-grid">
        <section className="cockpit-card">
          <SectionHead title="每天和有效客户的消息" detail={`${data.daily.label} · 鼠标移到点上看当${data.daily.view === 'day' ? '天' : data.daily.view === 'week' ? '周' : '月'}的组数`} />
          <Lines data={data} />
        </section>
        <section className="cockpit-card">
          <div className="cockpit-section-head">
            <div><h2>有效客户什么时候发消息</h2><p>收到的消息组 · 星期 × 小时</p></div>
            <div className="analytics-toggle" role="group" aria-label="时间">
              <Link href={here({ clock: 'company' })} aria-current={filters.clock === 'company' ? 'page' : undefined}>{data.clock.company}</Link>
              <Link href={here({ clock: 'local' })} aria-current={filters.clock === 'local' ? 'page' : undefined}>客户当地时间</Link>
            </div>
          </div>
          <Heatmap data={data} />
        </section>
      </div>

      <div className="ca-tables">
        <section className="cockpit-card">
          <SectionHead title="我们回得多快" detail={`客户发来到我们回复 · ${number(data.speed.decided)} 次（客户连发几条算一次）`} />
          {data.speed.decided ? <>
            <span className="ma-speed-bar" aria-hidden>{data.speed.buckets.map((bucket, index) => bucket.count ? <i key={bucket.label} style={{ flex: bucket.count, background: SPEED_COLORS[index] }} /> : null)}</span>
            <div className="ma-speed-list">
              {data.speed.buckets.map((bucket, index) => (
                <div key={bucket.label}><i style={{ background: SPEED_COLORS[index] }} /><span>{bucket.label}</span><strong>{number(bucket.count)}</strong><small>{percent(bucket.share)}</small></div>
              ))}
            </div>
            {data.speed.pending > 0 && <p className="cockpit-note">还有 {data.speed.pending} 次不到一天、还没回，暂不计入。</p>}
          </> : <Empty />}
        </section>

        <section className="cockpit-card">
          <SectionHead title="有效客户的聊天现在怎样" detail={`正在跟进的 ${number(data.effectiveCustomers)} 位`} />
          {data.states.map(state => (
            <div key={state.key} className="ma-state">
              <div><i style={{ background: STATE_COLORS[state.key] }} /><strong>{state.label}</strong><b>{number(state.count)}</b></div>
              {state.people.length > 0 && <p>{state.people.map(person => (
                <Link key={person.id} href={`/messages?customer=${encodeURIComponent(person.id)}`}><em style={{ background: GRADE[person.grade] ?? '#8e8d86' }}>{person.grade}</em>{person.name}</Link>
              ))}{state.count > state.people.length && <span>等 {number(state.count)} 位</span>}</p>}
            </div>
          ))}
        </section>

        <section className="cockpit-card">
          <SectionHead title="负责人" detail="只算各自的有效客户" />
          {data.owners.length ? data.owners.map(owner => (
            <div key={owner.id} className="ma-owner">
              <div>
                <span className="ma-owner-mark" aria-hidden>{owner.name.slice(0, 1).toUpperCase()}</span>
                <strong>{owner.id === 'pool' ? owner.name : <Link href={here({ owner: owner.id })}>{owner.name}</Link>}</strong>
                <em className={owner.waiting ? 'is-late' : undefined}>{owner.waiting ? `${owner.waiting} 位等回复` : '没有人在等'}</em>
              </div>
              <div className="ma-owner-facts">
                <span><small>有效客户</small><b>{number(owner.customers)}</b></span>
                <span><small>收 / 发</small><b>{number(owner.received)} / {number(owner.sent)}</b></span>
                <span><small>回复中位数</small><b>{minutesText(owner.median)}</b></span>
              </div>
            </div>
          )) : <Empty />}
        </section>
      </div>

      <p className="cockpit-note analytics-footnote">
        只统计和有效客户（A / B 级，并且在我们发出第一条消息后回复了）的聊天，不含发送失败和待发送的消息；同一方 {data.groupMinutes} 分钟内连发的算一组，对方的自动回复不算。回复速度从客户一轮消息的第一条算到我们的下一条；超过一天没回算「超过 24 小时或没回」，不到一天还没回的暂不计入。发送方式只筛选我们发出的消息。等我们回复、3 天没动静按客户现在的状态（已成交、流失、无效、暂不需要的不算）。
      </p>
    </div>
  );
}

function Empty() {
  return <p className="analytics-empty">这段时间没有和有效客户的消息，换一个时间段或筛选看看。</p>;
}

function Stat({ title, value, detail, compare, good, spark, color, href }: {
  title: string; value: string; detail: string; compare: string | null; good: boolean; spark?: (number | null)[]; color?: string; href?: string;
}) {
  const values = (spark ?? []).map(v => v ?? 0), max = Math.max(1, ...values);
  const points = values.length > 1 ? values.map((v, i) => `${(4 + i * 112 / (values.length - 1)).toFixed(1)},${(32 - v / max * 28).toFixed(1)}`).join(' ') : '';
  return (
    <div className="ma-stat">
      <span className="ma-stat-title">{title}</span>
      <div><strong>{value}</strong>{points && <svg width="120" height="36" viewBox="0 0 120 36" aria-hidden><polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" /></svg>}</div>
      <small>{detail}</small>
      {compare && (href ? <Link href={href} className="ma-stat-compare is-down">{compare}</Link> : <span className={`ma-stat-compare${good ? '' : ' is-down'}`}>{compare}</span>)}
    </div>
  );
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
      <svg className="cockpit-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="每天有效客户发来与我们发出的消息组数折线图">
        {[0, .5, 1].map(fraction => (
          <g key={fraction}>
            <line x1={left} x2={width - right} y1={top + plotH * fraction} y2={top + plotH * fraction} className="cockpit-grid-line" />
            <text x={left - 8} y={top + plotH * fraction + 4} textAnchor="end" className="cockpit-axis-text">{Math.round(max * (1 - fraction))}</text>
          </g>
        ))}
        <path d={`${path('inbound')} L ${x(points.length - 1).toFixed(1)} ${top + plotH} L ${x(0).toFixed(1)} ${top + plotH} Z`} fill={LINE.inbound} fillOpacity={0.07} />
        <path d={path('outbound')} fill="none" stroke={LINE.outbound} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path('inbound')} fill="none" stroke={LINE.inbound} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => (
          <g key={point.start}>
            <title>{`${point.label}：客户发来 ${point.inbound} 组 · 我们发出 ${point.outbound} 组`}</title>
            <rect x={x(index) - plotW / Math.max(1, points.length) / 2} y={top} width={plotW / Math.max(1, points.length)} height={plotH} fill="transparent" />
            <circle cx={x(index)} cy={y(point.inbound)} r={3.5} fill="#fff" stroke={LINE.inbound} strokeWidth={2} />
            <circle cx={x(index)} cy={y(point.outbound)} r={2.5} fill={LINE.outbound} />
          </g>
        ))}
        {labelIndices.map(index => <text key={index} x={x(index)} y={height - 8} textAnchor="middle" className="cockpit-axis-text">{points[index]?.label}</text>)}
      </svg>
      <div className="ca-legend">
        <span><i style={{ background: LINE.inbound }} />有效客户发来 {number(inbound)} 组</span>
        <span><i style={{ background: LINE.outbound }} />我们发出 {number(outbound)} 组</span>
      </div>
      <details className="cockpit-chart-data">
        <summary>查看图表数据</summary>
        <table><thead><tr><th>日期</th><th>客户发来</th><th>我们发出</th><th>回复中位数</th></tr></thead>
          <tbody>{points.map(point => <tr key={point.start}><td>{point.label}</td><td>{point.inbound}</td><td>{point.outbound}</td><td>{minutesText(point.speed)}</td></tr>)}</tbody></table>
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
      <div className="analytics-heatmap" role="img" aria-label={`有效客户发消息的时间分布，${zone}`}>
        <span />
        {Array.from({ length: 24 }, (_, hour) => <span key={hour} className="analytics-heatmap-hour">{hour % 3 === 0 ? hour : ''}</span>)}
        {cells.map((row, day) => [
          <span key={`d${day}`} className="analytics-heatmap-day">{WEEKDAYS[day]}</span>,
          ...row.map((value, hour) => <i key={`${day}-${hour}`} style={{ background: shade(value) }} title={`${WEEKDAYS[day]} ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00 ${zone}：${value} 组`} />),
        ])}
      </div>
      <div className="analytics-heatmap-scale" aria-hidden><span>少</span>{RAMP.map(color => <i key={color} style={{ background: color }} />)}<span>多</span></div>
      <p className="ca-insight is-plain">
        {busiest ? <span>最活跃：{zone} <b>{busiest}</b>，这段时间保证有人在线，等回复最短。</span> : <span>消息还不够多，看不出规律。</span>}
        {weekend !== null && weekend !== 0 ? <span>周末每天比工作日{weekend < 0 ? '少' : '多'} {Math.abs(weekend)}%。</span> : null}
        {data.filters.clock === 'local' && data.clock.unknown ? <span>有 {data.clock.unknown} 组消息的客户国家没有对应时区，未计入。</span> : null}
      </p>
    </>
  );
}
