import Link from 'next/link';
import { ArrowRight, CircleAlert, Info, Sparkles } from 'lucide-react';
import type { DailyBrief } from '@/services/boss-brief-service';

const amount = (money: { currency: string; amount: string }[]) => money.map(m => `${m.currency} ${Number(m.amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`).join(' + ');
const time = (iso: string, timeZone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const minutes = (value: number | null) => value === null ? '—' : value < 60 ? `${value} 分钟` : `${Math.round(value / 6) / 10} 小时`;

/** The boss's morning brief at the top of the cockpit: the same text that was pushed to the phone at 08:00. */
export function DailyBriefCard({ brief }: { brief: DailyBrief }) {
 const { facts: f, text } = brief;
 const day = `${Number(f.date.slice(5, 7))}月${Number(f.date.slice(8, 10))}日`;
 const grades = f.leads.grades.map(g => `${g.grade} ${g.count}`).join(' · ');
 const timePassed = Math.round(f.month.day / f.month.days * 100);
 const lists = [
  { title: '值得注意', items: text.highlights, ordered: false },
  { title: '风险', items: text.risks, ordered: false },
  { title: '今天建议', items: text.actions, ordered: true },
 ].filter(list => list.items.length);
 return <section id="brief" className="cockpit-card cockpit-brief" aria-labelledby="brief-headline">
  <div className="cockpit-brief-head">
   <span className="cockpit-brief-kicker"><Sparkles size={14}/>今日简报 · {day}</span>
   <span className="cockpit-brief-source">{brief.source === 'AI' ? 'AI 根据数据整理' : '按规则生成'}{brief.stored ? ` · 数据截至 ${time(f.generatedAt, f.timezone)}` : ' · 08:00 后生成当天简报并推送到手机'}</span>
  </div>
  <h2 id="brief-headline">{text.headline}</h2>
  <div className="cockpit-brief-stats">
   <div><span>昨日新线索</span><strong>{f.leads.total}<small> 条</small></strong><em>{grades || '—'}{f.leads.weekAverage ? ` · 7 日均 ${f.leads.weekAverage}` : ''}</em></div>
   <div><span>昨日成交</span><strong>{f.results.deals}<small> 单</small></strong><em>{f.results.amount.length ? amount(f.results.amount) : '—'}</em></div>
   <div><span>昨日发出报价</span><strong>{f.results.quotes}<small> 份</small></strong><em>已发送给客户</em></div>
   {f.month.target
    ? <div><span>本月目标完成</span><strong>{f.month.target.completion}<small>%</small></strong><em>时间已过 {timePassed}%</em></div>
    : <div><span>本月成交</span><strong className="is-text">{f.month.revenue.length ? amount(f.month.revenue) : '—'}</strong><em>未设置本月目标</em></div>}
  </div>
  {lists.length > 0 && <div className="cockpit-brief-lists">{lists.map(list => <div key={list.title}><h3>{list.title}</h3>{list.ordered
   ? <ol>{list.items.map((item, index) => <li key={index}>{item}</li>)}</ol>
   : <ul>{list.items.map((item, index) => <li key={index}>{item}</li>)}</ul>}</div>)}</div>}
  {brief.links.length > 0 && <div className="cockpit-brief-links" aria-label="现在要处理">{brief.links.map(link => <Link key={link.href} href={link.href} className={`is-${link.tone}`}>
   {link.tone === 'risk' ? <CircleAlert size={14}/> : <Info size={14}/>}{link.label}<ArrowRight size={13}/></Link>)}</div>}
  {(f.firstContact.length > 0 || f.losses.length > 0) && <div className="cockpit-brief-more">
   {f.firstContact.length > 0 && <div><h3>昨日分配线索的首联速度</h3><div className="cockpit-brief-table" role="table" aria-label="昨日分配线索的首联速度">
    <div role="row" className="is-head"><span role="columnheader">销售</span><span role="columnheader">分配</span><span role="columnheader">按时</span><span role="columnheader">超时</span><span role="columnheader">用时中位数</span></div>
    {f.firstContact.map(p => <div role="row" key={p.name}><span role="cell">{p.name}</span><span role="cell">{p.assigned}</span><span role="cell">{p.onTime}</span><span role="cell" className={p.late ? 'is-late' : ''}>{p.late}</span><span role="cell">{minutes(p.medianMinutes)}</span></div>)}
   </div></div>}
   {f.losses.length > 0 && <div><h3>本月流失原因</h3><div className="cockpit-brief-losses">{f.losses.map(loss => <span key={loss.reason}>{loss.reason}<b>{loss.count}</b></span>)}</div>
    <p className="cockpit-note">本月改为已流失、暂不需要或无效的客户，按填写的原因统计。</p></div>}
  </div>}
 </section>;
}
