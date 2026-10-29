import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import { Header, Table } from '@/components/ui/bos';
import { PeriodPicker } from '@/components/period-picker';
import { METRIC_NOTES } from '@/lib/metric-notes';
import type { CustomerAnalytics as Data } from '@/services/customer-analytics-service';
import { AnalyticsFilters } from './AnalyticsFilters';
import { Kpi, SectionHead, changeText, minutesText, number, percent, pointsText, toneOf } from './AnalyticsParts';

const BASE = '/command-center/customers';
/** Grade colours, darkest for A (validated for contrast with the dataviz palette check). */
const GRADE_COLORS = { A: '#164b3a', B: '#3a7d63', C: '#7fb59b', D: '#8e8d86', none: '#d6d5cf', other: '#b4b2a9' } as const;
const GRADE_NOTES: Record<string, string> = { D: '无效线索，不跟进', none: '等待评级' };

/** 客户分析 (docs/METRICS.md §客户分析): the period's new leads by grade, how far they got and where they are now. */
export function CustomerAnalytics({ data }: { data: Data }) {
  const { selected, filters } = data;
  const period: Record<string, string> = { range: selected.range, ...(selected.range === 'custom' ? { startDate: selected.startKey, endDate: selected.endKey } : {}) };
  const active = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
  // The customer list, for the same period and filters (it reads the same inquiry dates).
  const list = (extra: Record<string, string> = {}) => `/customers?${new URLSearchParams({ group: 'all', from: selected.startKey, to: selected.endKey, ...active, ...extra })}`;
  const here = (extra: Record<string, string>) => `${BASE}?${new URLSearchParams({ ...period, ...active, ...extra })}`;
  const gradeTotal = Math.max(1, data.total);
  const funnelAll = data.funnel.rows.find(row => row.key === 'all')!.counts;

  return (
    <div className="business-cockpit bos-analytics">
      <Header title="客户分析" description={`新增线索按询盘日期归属 · ${selected.startKey} — ${selected.endKey}，截至当前 · 与上一同长周期对比`}
        actions={<PeriodPicker basePath={BASE} selected={selected} keep={active} />} />
      <AnalyticsFilters basePath={BASE} keep={period} fields={[
        { name: 'owner', label: '负责人', value: filters.owner, options: data.options.owners.map(owner => ({ value: owner.id, label: owner.name })) },
        { name: 'source', label: '来源', value: filters.source, options: data.options.sources.map(source => ({ value: source.key, label: source.label })) },
        { name: 'country', label: '国家', value: filters.country, options: data.options.countries.map(country => ({ value: country, label: country })) },
        { name: 'grade', label: '等级', value: filters.grade, options: [...['A', 'B', 'C', 'D'].map(grade => ({ value: grade, label: grade })), { value: 'none', label: '未评级' }] },
      ]} />

      <section className="cockpit-kpis analytics-kpis" aria-label="客户核心指标">
        <Kpi label="新增线索" value={number(data.total)} unit="位" compare={data.totalChange === null ? null : `比上期 ${changeText(data.totalChange)}（${number(data.previousTotal)}）`} tone={toneOf(data.totalChange)}>
          <span className="analytics-grade-bar" aria-hidden>
            {data.grades.map(grade => grade.count ? <i key={grade.key} style={{ width: `${grade.count / gradeTotal * 100}%`, background: GRADE_COLORS[grade.key as keyof typeof GRADE_COLORS] }} /> : null)}
          </span>
          <span className="analytics-kpi-detail">{data.grades.map(grade => `${grade.label} ${grade.count}`).join(' · ')}</span>
        </Kpi>
        <Kpi label="优质线索（A + B）" value={number(data.good.count)} unit="位" detail={`占新增 ${percent(data.good.share)}`}
          compare={data.good.previousShare === null ? null : `上期 ${data.good.previousShare}% · ${pointsText(data.good.points)}`} tone={toneOf(data.good.points)} />
        <Kpi label="有效客户" value={number(data.qualified.count)} unit="位" detail={`有效率 ${percent(data.qualified.rate)}（我们发出第一条后客户回复）`}
          compare={data.qualified.previousRate === null ? null : `上期 ${data.qualified.previousRate}% · ${pointsText(data.qualified.points)}`} tone={toneOf(data.qualified.points)} />
        <Kpi label="已报价 · 成交" value={number(data.quoted)} unit={`/ ${number(data.won)} 位`} detail={`线索 → 成交 ${percent(data.wonRate)}`}
          compare={data.previousWonRate === null ? null : `上期 ${data.previousWonRate}% · ${pointsText(data.wonPoints)}`} tone={toneOf(data.wonPoints)} />
        <Kpi label="A / B 首联按时率" value={percent(data.firstContact.rate)} detail={`在首联期限内联系 · 用时中位数 ${minutesText(data.firstContact.medianMinutes)}`}
          alert={data.firstContact.overdue > 0}
          action={data.firstContact.overdue ? { href: '/sales?queue=new', label: `超时未联系 ${data.firstContact.overdue} 位 · 去处理` } : null} />
      </section>

      <div className="analytics-grid is-wide">
        <section className="cockpit-card">
          <SectionHead title="每天来了哪些等级" detail={`${data.daily.label} · 按询盘日期，点击柱子打开当${data.daily.view === 'day' ? '天' : data.daily.view === 'week' ? '周' : '月'}的线索名单`} />
          <GradeBars data={data} list={list} />
        </section>
        <section className="cockpit-card">
          <SectionHead title="等级占比" detail="点击等级打开名单" />
          {data.total ? (
            <div className="analytics-rows">
              {data.grades.map(grade => (
                <Link key={grade.key} href={list({ grade: grade.key })} className="analytics-row">
                  <span className="analytics-row-label"><i className="analytics-dot" style={{ background: GRADE_COLORS[grade.key as keyof typeof GRADE_COLORS] }} />{grade.label}</span>
                  <span className="analytics-track"><span style={{ width: `${grade.count / Math.max(1, ...data.grades.map(g => g.count)) * 100}%`, background: GRADE_COLORS[grade.key as keyof typeof GRADE_COLORS] }} /></span>
                  <strong>{number(grade.count)}</strong>
                  <small>{percent(grade.share)}</small>
                  <small className="analytics-row-note">{GRADE_NOTES[grade.key] ?? `比上期 ${grade.change >= 0 ? '+' : ''}${grade.change}`}</small>
                </Link>
              ))}
            </div>
          ) : <Empty />}
        </section>
      </div>

      <section className="cockpit-card">
        <SectionHead title="销售漏斗 · 按等级" detail={`${selected.label}询盘的 ${number(data.total)} 位客户，到今天为止推进到过哪一步（后来流失的也算到过）`} href={list()} action="打开名单" />
        {data.total ? (
          <div className="analytics-funnel">
            <div className="analytics-funnel-bars">
              {data.funnel.steps.map((step, index) => (
                <div key={step} className="analytics-funnel-step" title={`${step}：${funnelAll[index]} 位，占线索 ${percent(rateOf(funnelAll[index], funnelAll[0]))}`}>
                  <span className="analytics-funnel-label">{step}</span>
                  <span className="analytics-funnel-track"><span style={{ width: `${Math.max(1.5, funnelAll[index] / Math.max(1, funnelAll[0]) * 100)}%` }} /></span>
                  <strong>{number(funnelAll[index])}</strong>
                  <small>{index ? `上一步转化 ${percent(rateOf(funnelAll[index], funnelAll[index - 1]))}` : percent(rateOf(funnelAll[0], funnelAll[0]))}</small>
                </div>
              ))}
            </div>
            <div>
              <Table caption="各等级在漏斗每一步的人数与转化率" headings={['等级', ...data.funnel.steps]}>
                {data.funnel.rows.map(row => (
                  <tr key={row.key} className={row.key === 'all' ? 'analytics-total-row' : undefined}>
                    <th scope="row">{row.label}</th>
                    {row.counts.map((count, index) => (
                      <td key={index} className={index === row.weakest ? 'analytics-weakest' : undefined}>
                        {number(count)}{index > 0 && <small>{percent(rateOf(count, row.counts[index - 1]))}</small>}
                      </td>
                    ))}
                  </tr>
                ))}
              </Table>
              <p className="cockpit-note">人数 · 比上一步的转化率；黄色是这个等级流失最多的一步。</p>
            </div>
          </div>
        ) : <Empty />}
        {data.funnel.insight && <div className="cockpit-diagnosis"><CircleAlert size={17} aria-hidden /><span>{data.funnel.insight}</span></div>}
      </section>

      <div className="analytics-grid">
        <section className="cockpit-card">
          <SectionHead title="这批客户现在在哪" detail="每位客户只算在一个位置" />
          {data.statuses.length ? (
            <div className="analytics-rows">
              {data.statuses.map(status => {
                const href = status.key === 'INVALID' ? list({ stage: 'INVALID' }) : status.key === 'POOL' ? list({ assign: 'pending' }) : null;
                const body = <>
                  <span className="analytics-row-label">{status.label}</span>
                  <span className="analytics-track"><span className={`is-${status.key === 'WON' ? 'won' : status.key === 'FIRST_CONTACT' || status.key === 'POOL' ? 'urgent' : 'plain'}`} style={{ width: `${status.count / Math.max(1, data.statuses[0].count) * 100}%` }} /></span>
                  <strong>{number(status.count)}</strong>
                  <small>{percent(status.share)}</small>
                </>;
                return href ? <Link key={status.key} href={href} className="analytics-row">{body}</Link> : <div key={status.key} className="analytics-row">{body}</div>;
              })}
            </div>
          ) : <Empty />}
        </section>
        <section className="cockpit-card">
          <SectionHead title="哪个来源带来好客户" detail="条形 = A / B / C / D·未评级 的比例；点来源只看这个来源" />
          {data.sources.length ? (
            <div className="analytics-mix">
              {data.sources.map(source => (
                <div key={source.filterable ? source.key : `~${source.label}`} className="analytics-mix-row" title={`${source.label}：A ${source.A} · B ${source.B} · C ${source.C} · D/未评级 ${source.other}`}>
                  <div className="analytics-mix-head">
                    {source.filterable ? <Link href={here({ source: source.key })}>{source.label}</Link> : <span>{source.label}</span>}
                    <small>{number(source.total)} 位 · A {source.A} · B {source.B} · C {source.C} · 有效率 <b>{percent(source.qualifiedRate)}</b></small>
                  </div>
                  <MixBar parts={[[source.A, GRADE_COLORS.A], [source.B, GRADE_COLORS.B], [source.C, GRADE_COLORS.C], [source.other, GRADE_COLORS.other]]} total={source.total} />
                </div>
              ))}
              <Legend items={[['A', GRADE_COLORS.A], ['B', GRADE_COLORS.B], ['C', GRADE_COLORS.C], ['D / 未评级', GRADE_COLORS.other]]} />
            </div>
          ) : <Empty />}
        </section>
      </div>

      <div className="analytics-grid">
        <section className="cockpit-card">
          <SectionHead title="国家 · 前 7 名" detail="深色 = A + B；点国家只看这个国家" />
          {data.countries.length ? (
            <div className="analytics-rows">
              {data.countries.map(country => {
                const most = Math.max(1, ...data.countries.map(row => row.total)), good = country.A + country.B;
                return (
                  <div key={country.filterable ? country.key : `~${country.label}`} className="analytics-row" title={`${country.label}：${country.total} 位，A+B ${good}`}>
                    <span className="analytics-row-label">{country.filterable ? <Link href={here({ country: country.key })}>{country.label}</Link> : country.label}</span>
                    <span className="analytics-track is-split"><span style={{ width: `${good / most * 100}%`, background: GRADE_COLORS.A }} /><span style={{ width: `${(country.total - good) / most * 100}%`, background: GRADE_COLORS.other }} /></span>
                    <strong>{number(country.total)}</strong>
                    <small>A+B {good}</small>
                  </div>
                );
              })}
            </div>
          ) : <Empty />}
        </section>
        <section className="cockpit-card">
          <SectionHead title="负责人" detail="首联按时只看 A / B；有效率 = 有效 ÷ 线索" />
          {data.owners.length ? (
            <Table caption="负责人与等级" headings={['负责人', '线索', 'A', 'B', 'C', '首联按时', '有效', '报价', '成交']}>
              {data.owners.map(owner => (
                <tr key={owner.id}>
                  <td>{owner.id === 'pool' ? <Link href={list({ assign: 'pending' })}>{owner.name}</Link> : <Link href={here({ owner: owner.id })}>{owner.name}</Link>}</td>
                  <td>{number(owner.total)}</td><td>{owner.A}</td><td>{owner.B}</td><td>{owner.C}</td>
                  <td>{percent(owner.onTimeRate)}</td>
                  <td>{owner.qualified}<small>{percent(owner.qualifiedRate)}</small></td>
                  <td>{owner.quoted}</td><td>{owner.won}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty />}
        </section>
      </div>

      <section className="cockpit-card">
        <SectionHead title="等级判得准不准" detail="评级来源，以及人工改动的方向" />
        <p className="analytics-text">
          AI 判定 {number(data.grading.ai)} · 规则判定 {number(data.grading.rule)} · 人工确认或改过 {number(data.grading.human)} · 未评级 {number(data.grading.ungraded)}。
          {data.grading.changes.length
            ? <> 人工改动 {data.grading.changed} 位：{data.grading.changes.map(change => `${change.label} ${change.count} 位`).join('，')}。</>
            : ' 这段时间没有人工改动等级。'}
        </p>
        <p className="cockpit-note">改得多的方向，说明自动评级在这类客户上判不准，可以据此调整评级规则。</p>
      </section>

      <p className="cockpit-note analytics-footnote">
        {METRIC_NOTES.newInquiries}{METRIC_NOTES.qualified}漏斗按客户到过的最远一步统计：已联系 = 我们发过消息、记过跟进或完成首联；需求确认 = 到过「已确认需求」；已报价 = 发过报价；成交 = 有成交记录。比上期 = 与紧挨着的同样长的一段时间相比。
      </p>
    </div>
  );
}

const rateOf = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 10 : null;
function Empty() {
  return <p className="analytics-empty">这段时间没有符合条件的线索，换一个时间段或筛选看看。</p>;
}
function MixBar({ parts, total }: { parts: [number, string][]; total: number }) {
  return <span className="analytics-mixbar" aria-hidden>{parts.map(([count, color], index) => count ? <i key={index} style={{ width: `${count / Math.max(1, total) * 100}%`, background: color }} /> : null)}</span>;
}
function Legend({ items }: { items: [string, string][] }) {
  return <div className="cockpit-chart-legend analytics-legend">{items.map(([label, color]) => <span key={label}><i className="analytics-swatch" style={{ background: color }} />{label}</span>)}</div>;
}

/** Stacked bars of the leads per day (week, month), A at the bottom. */
function GradeBars({ data, list }: { data: Data; list: (extra?: Record<string, string>) => string }) {
  const points = data.daily.points;
  const width = 760, height = 230, left = 34, right = 10, top = 12, bottom = 30;
  const plotW = width - left - right, plotH = height - top - bottom;
  const totals = points.map(point => point.A + point.B + point.C + point.other);
  const max = Math.max(1, ...totals);
  const slot = plotW / Math.max(1, points.length), bar = Math.max(2, Math.min(28, slot * .68));
  const labelIndices = [...new Set([0, Math.floor((points.length - 1) / 4), Math.floor((points.length - 1) / 2), Math.floor((points.length - 1) * 3 / 4), points.length - 1])];
  if (!totals.some(Boolean)) return <Empty />;
  return (
    <div className="cockpit-chart-wrap">
      <svg className="cockpit-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="每天新增线索按等级的堆叠柱状图">
        {[0, .5, 1].map(fraction => (
          <g key={fraction}>
            <line x1={left} x2={width - right} y1={top + plotH * fraction} y2={top + plotH * fraction} className="cockpit-grid-line" />
            <text x={left - 8} y={top + plotH * fraction + 4} textAnchor="end" className="cockpit-axis-text">{Math.round(max * (1 - fraction))}</text>
          </g>
        ))}
        {points.map((point, index) => {
          const x = left + slot * index + (slot - bar) / 2;
          let y = top + plotH;
          const segments = ([['A', point.A], ['B', point.B], ['C', point.C], ['other', point.other]] as const).map(([grade, count]) => {
            const h = count / max * plotH; y -= h;
            return count ? <rect key={grade} x={x} y={y} width={bar} height={Math.max(0, h - (h > 3 ? 1.5 : 0))} rx={2} fill={GRADE_COLORS[grade]} /> : null;
          });
          return (
            <a key={point.start} href={list({ from: point.start, to: point.end })} aria-label={`${point.label}：${totals[index]} 位`}>
              <title>{`${point.label}：共 ${totals[index]} 位 · A ${point.A} · B ${point.B} · C ${point.C} · D/未评级 ${point.other}`}</title>
              <rect x={left + slot * index} y={top} width={slot} height={plotH} fill="transparent" />
              {segments}
            </a>
          );
        })}
        {labelIndices.map(index => <text key={index} x={left + slot * index + slot / 2} y={height - 8} textAnchor="middle" className="cockpit-axis-text">{points[index]?.label}</text>)}
      </svg>
      <Legend items={[['A', GRADE_COLORS.A], ['B', GRADE_COLORS.B], ['C', GRADE_COLORS.C], ['D / 未评级', GRADE_COLORS.other]]} />
      <details className="cockpit-chart-data">
        <summary>查看图表数据</summary>
        <table><thead><tr><th>日期</th><th>A</th><th>B</th><th>C</th><th>D / 未评级</th><th>合计</th></tr></thead>
          <tbody>{points.map((point, index) => <tr key={point.start}><td>{point.label}</td><td>{point.A}</td><td>{point.B}</td><td>{point.C}</td><td>{point.other}</td><td>{totals[index]}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
