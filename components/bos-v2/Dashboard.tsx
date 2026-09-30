import Link from 'next/link';
import { ArrowRight, ArrowUpRight, CalendarDays, CircleAlert, Sparkles, TrendingUp } from 'lucide-react';
import { CountUp } from '@/components/ui/count-up';
import type { BusinessCockpit } from '@/services/business-cockpit-service';
import { greeting } from '@/lib/bos';

const money = (value: number, currency: string) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
const percent = (value: number | null) => value === null ? '—' : `${value}%`;
function SectionHead({ eyebrow, title, detail, href, action }: { eyebrow: string; title: string; detail?: string; href?: string; action?: string }) {
 return <div className="cockpit-section-head"><div><span className="cockpit-eyebrow">{eyebrow}</span><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{href && <Link href={href}>{action || '查看详情'} <ArrowUpRight size={14}/></Link>}</div>;
}

function TrendChart({ trend, currency }: { trend: BusinessCockpit['trend']; currency: string }) {
 const width = 760, height = 236, left = 46, right = 24, top = 20, bottom = 35;
 const plotW = width - left - right, plotH = height - top - bottom;
 const maxRevenue = Math.max(1, ...trend.points.map(point => point.revenue));
 const maxOrders = Math.max(1, ...trend.points.map(point => point.orders));
 const position = (index: number, value: number, max: number) => ({ x: left + (trend.points.length === 1 ? plotW / 2 : index * plotW / (trend.points.length - 1)), y: top + plotH - (value / max) * plotH });
 const path = (field: 'revenue' | 'orders', max: number) => trend.points.map((point, index) => { const { x, y } = position(index, point[field], max); return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
 const labelIndices = [...new Set([0, Math.floor((trend.points.length - 1) / 4), Math.floor((trend.points.length - 1) / 2), Math.floor((trend.points.length - 1) * 3 / 4), trend.points.length - 1])];
 return <div className="cockpit-chart-wrap"><svg className="cockpit-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="销售额和订单数量趋势折线图">
  {[0, .5, 1].map(fraction => <g key={fraction}><line x1={left} x2={width - right} y1={top + plotH * fraction} y2={top + plotH * fraction} className="cockpit-grid-line"/><text x={left - 10} y={top + plotH * fraction + 4} textAnchor="end" className="cockpit-axis-text">{number(Math.round(maxRevenue * (1 - fraction)))}</text></g>)}
  <path d={path('revenue', maxRevenue)} className="cockpit-revenue-line"/><path d={path('orders', maxOrders)} className="cockpit-orders-line"/>
  {trend.points.map((point, index) => { const revenue = position(index, point.revenue, maxRevenue); return <circle key={index} cx={revenue.x} cy={revenue.y} r="3" className="cockpit-chart-dot"><title>{`${point.label}：销售额 ${money(point.revenue, currency)}，订单 ${point.orders} 笔`}</title></circle>; })}
  {labelIndices.map(index => <text key={index} x={position(index, 0, 1).x} y={height - 5} textAnchor="middle" className="cockpit-axis-text">{trend.points[index]?.label}</text>)}
 </svg><div className="cockpit-chart-legend"><span><i className="is-revenue"/>销售额 · {currency}</span><span><i className="is-orders"/>订单数 · 独立比例</span></div><details className="cockpit-chart-data"><summary>查看图表数据</summary><table><thead><tr><th>期间</th><th>销售额</th><th>订单数</th></tr></thead><tbody>{trend.points.map(point => <tr key={point.label}><td>{point.label}</td><td>{money(point.revenue, currency)}</td><td>{point.orders}</td></tr>)}</tbody></table></details></div>;
}

function PeriodPicker({ selected }: { selected: BusinessCockpit['selected'] }) {
 const options = [{ key: 'today', label: '今天' }, { key: 'week', label: '本周' }, { key: 'month', label: '本月' }, { key: 'quarter', label: '本季度' }, { key: 'year', label: '年度' }];
 return <div className="cockpit-filter" aria-label="时间筛选"><CalendarDays size={16}/><div className="cockpit-filter-links">{options.map(option => <Link key={option.key} href={`/command-center?range=${option.key}`} aria-current={selected.range === option.key ? 'page' : undefined}>{option.label}</Link>)}</div><details className="cockpit-custom" open={selected.range === 'custom'}><summary>自定义</summary><form action="/command-center"><input type="hidden" name="range" value="custom"/><label>开始<input aria-label="开始日期" type="date" name="startDate" defaultValue={selected.startKey} required/></label><label>结束<input aria-label="结束日期" type="date" name="endDate" defaultValue={selected.endKey} required/></label><button type="submit">应用</button></form></details></div>;
}

export function Dashboard({ data, name }: { data: BusinessCockpit; name: string }) {
 const { kpis, goal, selected, currency } = data;
 const goalAvailable = goal.periodGoal !== null;
 const actionFirst = selected.range === 'today' || selected.range === 'week';
 const compare = '较前一等长区间';
 const cards = [
  { label: `${selected.label}成交额`, value: kpis.periodRevenue, unit: currency, detail: '同币种已成交', trend: data.kpiTrends.periodRevenue, compare, href: '/orders', tone: 'primary' },
  { label: `${selected.label}报价额`, value: kpis.quotedAmount, unit: currency, detail: '已发送报价', trend: data.kpiTrends.quotedAmount, compare, href: '/sales', tone: '' },
  { label: `${selected.label}毛利润`, value: kpis.grossProfit, unit: currency, detail: kpis.grossProfit === null ? '仅管理员可查看' : '成交毛利', trend: data.kpiTrends.grossProfit, compare, href: kpis.grossProfit === null ? '/sales' : '/finance', tone: '' },
  { label: `${selected.label}订单`, value: kpis.periodOrders, unit: '笔', detail: '非取消订单', trend: data.kpiTrends.periodOrders, compare, href: '/orders', tone: '' },
  { label: `${selected.label}新增客户`, value: kpis.newCustomers, unit: '位', detail: 'CRM 新增', trend: data.kpiTrends.newCustomers, compare, href: '/crm', tone: '' },
  goalAvailable ? { label: `${selected.label}目标完成率`, value: kpis.completion, unit: '%', detail: `目标 ${money(goal.periodGoal!, currency)}`, trend: null, compare: '', href: '/command-center/legacy', tone: 'goal' } : { label: `${selected.label}任务完成率`, value: data.execution.completion, unit: '%', detail: data.execution.dueTasks ? `${data.execution.doneTasks} / ${data.execution.dueTasks} 项到期任务` : '本期无到期任务', trend: null, compare: '', href: '/tasks', tone: 'goal' },
 ];
 const totalChannels = data.channels.reduce((sum, channel) => sum + channel.customers, 0);
 const hues = ['#1c654b', '#5d9874', '#93bba2', '#c1d6c4', '#e2eae1'];
 let position = 0;
 const stops = data.channels.map((channel, index) => { const start = position; position += totalChannels ? channel.customers / totalChannels * 100 : 0; return `${hues[index]} ${start}% ${position}%`; }).join(', ');
 const ringStyle = { background: totalChannels ? `conic-gradient(${stops})` : '#edf1ec' };
 const maxChannelRevenue = Math.max(1, ...data.channels.map(channel => channel.revenue));
 const funnelSection = <section className="cockpit-card cockpit-funnel"><SectionHead eyebrow={actionFirst ? '05 / CONVERSION' : '03 / CONVERSION'} title="Sales Funnel" detail={`${selected.label}新增客户的当前推进阶段`} href="/crm" action="打开客户中心"/><div className="cockpit-funnel-list">{data.funnel.map((stage, index) => <div className="cockpit-funnel-row" key={stage.label}><span className="cockpit-funnel-index">0{index + 1}</span><div><strong>{stage.label}</strong><div className="cockpit-funnel-track"><span style={{ width: `${data.funnel[0].count ? stage.count / data.funnel[0].count * 100 : 0}%` }}/></div></div><strong>{number(stage.count)}</strong><small>{stage.conversion === null ? '基数' : `${stage.conversion}% 转化`}</small></div>)}</div><div className="cockpit-diagnosis"><CircleAlert size={17}/><span>{data.funnelLoss ? `最大流失：${data.funnelLoss.from} → ${data.funnelLoss.to}，${data.funnelLoss.loss} 位客户` : '当前没有可识别的阶段流失'}</span></div><p className="cockpit-note">同一批新增客户的阶段快照；历史阶段变更可能未完整记录。</p></section>;
 const operationSection = <section className="cockpit-card cockpit-operation"><SectionHead eyebrow={actionFirst ? '03 / EXECUTION' : '04 / EXECUTION'} title="Operation Performance" detail="经营动作与内容运营" href="/tasks" action="查看待办"/><div className="cockpit-execution"><div><span>本期到期任务</span><strong>{number(data.execution.dueTasks)} <small>项</small></strong></div><div><span>已完成</span><strong>{number(data.execution.doneTasks)} <small>项</small></strong></div><div><span>执行率</span><strong>{percent(data.execution.completion)}</strong></div></div><div className="cockpit-content-empty"><span className="cockpit-empty-label">CONTENT OPERATIONS · 待接入</span><h3>内容发布与效果数据</h3><p>当前系统尚无内容发布、月目标、播放量和询盘归因的数据源；以下位置会在接入内容记录后显示真实数据。</p><div className="cockpit-platforms"><span>TikTok</span><span>Instagram</span><span>Facebook</span></div><div className="cockpit-content-placeholders"><span>{selected.label}发布 <b>—</b></span><span>{selected.label}目标 <b>—</b></span><span>完成率 <b>—</b></span></div><div className="cockpit-content-future"><div><strong>Content Growth</strong><span>过去 30 天发布趋势 · 待接入</span></div><div><strong>Top Content</strong><span>播放 / 询盘 / 转化 · 待接入</span></div></div></div></section>;
 const channelSection = <section className="cockpit-card cockpit-channel"><SectionHead eyebrow={actionFirst ? '06 / ATTRIBUTION' : '05 / ATTRIBUTION'} title="Channel Performance" detail={`${selected.label} · 渠道贡献`} href="/growth" action="进入增长中心"/><div className="cockpit-channel-layout"><div className="cockpit-donut" style={ringStyle} aria-label="客户来源占比"><div><strong>{number(totalChannels)}</strong><span>渠道客户</span></div></div><div className="cockpit-channel-list">{data.channels.map((channel, index) => <div className="cockpit-channel-row" key={channel.id}><div className="cockpit-channel-title"><span><i style={{ background: hues[index] }}/>{channel.name}</span><strong>{channel.customers} 位</strong></div><div className="cockpit-channel-bar"><span style={{ width: `${channel.revenue / maxChannelRevenue * 100}%`, background: hues[index] }}/></div><div className="cockpit-channel-data"><span>投入 {channel.spend.length ? channel.spend.map(item => money(item.amount, item.currency)).join(' · ') : '—'}</span><span>成交 {money(channel.revenue, currency)}</span><span>ROI {channel.roi === null ? '—' : `${channel.roi}%`}</span></div></div>)}</div></div><p className="cockpit-note">{data.attributionNote}“—”表示无可比数据。</p></section>;
 const assistantSection = <section className="cockpit-card cockpit-assistant"><SectionHead eyebrow={actionFirst ? '04 / NEXT ACTION' : '06 / NEXT ACTION'} title="AI Business Assistant" detail="基于现有业务数据的主动经营提示"/><div className="cockpit-assistant-greeting"><Sparkles size={19}/><span>{greeting(new Date(data.generatedAt), data.timezone)}, {name}</span></div><div className="cockpit-suggestions">{data.suggestions.map((suggestion, index) => <Link href={suggestion.href} key={`${suggestion.title}-${index}`}><span className={suggestion.kind === 'warning' ? 'is-warning' : 'is-insight'}>{suggestion.kind === 'warning' ? <CircleAlert size={17}/> : <TrendingUp size={17}/>}</span><div><strong>{suggestion.title}</strong><p>{suggestion.detail}</p></div><ArrowRight size={16}/></Link>)}</div><p className="cockpit-note">逾期任务与报价跟进按当前时点提醒；漏斗和渠道分析按所选区间统计。建议来自规则，尚未调用生成式 AI。</p></section>;
 return <div className="business-cockpit">
  <header className="cockpit-header"><div><span className="cockpit-eyebrow">LVANJU · BUSINESS OS</span><h1>经营驾驶舱</h1><p>Business Performance Overview <span>· {data.scope}视图 · {name}</span></p><small className="cockpit-period-caption">统计区间 {selected.startKey} — {selected.endKey} · 截至当前</small></div><PeriodPicker selected={selected}/></header>
  <section className="cockpit-kpis" aria-label="核心经营指标">{cards.map(card => <Link href={card.href} key={card.label} className={`cockpit-kpi ${card.tone ? `is-${card.tone}` : ''}`}><span className="cockpit-kpi-label">{card.label}<ArrowUpRight size={15}/></span><strong>{card.value === null ? '—' : <CountUp value={card.value} duration={750} decimals={card.value % 1 ? 1 : 0}/>}<small>{card.value === null ? '' : card.unit}</small></strong><span className="cockpit-kpi-detail">{card.trend === null ? card.detail : <><em className={card.trend >= 0 ? 'is-up' : 'is-down'}>{card.trend >= 0 ? '↑' : '↓'}{Math.abs(card.trend)}%</em> {card.compare}</>}</span></Link>)}</section>
  {data.excludedCurrencies.length > 0 && <p className="cockpit-currency-note">金额仅展示 {currency}；本期另有 {data.excludedCurrencies.join('、')} 成交或报价记录，未混合换算。</p>}
  <div className="cockpit-primary-grid">
   <section className="cockpit-card cockpit-goal"><SectionHead eyebrow="01 / OUTCOME" title={goalAvailable ? `${selected.label} Business Goal` : `${selected.label} Business Outcome`} detail={goalAvailable ? '本期目标与执行进度' : '本期结果与前一等长区间对比'}/><div className="cockpit-goal-values"><div><span>本期成交</span><strong>{money(goal.periodRevenue, currency)}</strong></div><div><span>{goalAvailable ? '本期目标' : '前一等长区间'}</span><strong>{goalAvailable ? money(goal.periodGoal!, currency) : money(goal.previousRevenue, currency)}</strong></div></div>{goalAvailable ? <><div className="cockpit-progress" role="progressbar" aria-label={`${selected.label}目标完成率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, goal.completion ?? 0)}><span style={{ width: `${Math.min(100, goal.completion ?? 0)}%` }}/></div><div className="cockpit-goal-remaining"><strong>{percent(goal.completion)}</strong><span>距离目标 {money(goal.remaining ?? 0, currency)}</span></div></> : <p className="cockpit-goal-unset">{data.scope === '个人' ? '团队目标仅管理员可查看。' : '当前范围没有独立销售目标。'}本期成交额与前一等长区间对比。</p>}{goal.breakdown.length > 0 && <div className="cockpit-quarter-grid">{goal.breakdown.map(item => <div key={item.label}><span>{item.label}</span><strong>{percent(item.completion)}</strong><small>{money(item.actual, currency)} / {item.goal === null ? '未设置' : money(item.goal, currency)}</small></div>)}</div>}<p className="cockpit-note">目标来自 SalesTarget；成交额来自所选区间内同币种成交记录。</p></section>
   <section className="cockpit-card cockpit-trend"><div className="cockpit-section-head"><div><span className="cockpit-eyebrow">02 / TREND</span><h2>Sales Growth Trend</h2><p>销售额与订单数量 · {data.trend.label}</p></div><span className="cockpit-segment-label">按{selected.trend === 'day' ? '日' : selected.trend === 'week' ? '周' : '月'}查看</span></div><TrendChart trend={data.trend} currency={currency}/></section>
  </div>
  <div className="cockpit-lower-grid">
   <div className="cockpit-secondary-grid">
    {actionFirst ? <>{operationSection}{assistantSection}</> : <>{funnelSection}{operationSection}</>}
   </div>
   <div className="cockpit-secondary-grid cockpit-bottom-grid">
    {actionFirst ? <>{funnelSection}{channelSection}</> : <>{channelSection}{assistantSection}</>}
   </div>
  </div>
 </div>;
}
