import Link from 'next/link';
import { ArrowUpRight,ArrowRight,Sparkles } from 'lucide-react';
import type { BosOverview } from '@/services/bos-v2-service';
import { greeting } from '@/lib/bos';

function displayMoney(values:{currency:string;amount:string}[]){return values.length?values.map(item=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:item.currency,maximumFractionDigits:0}).format(Number(item.amount))).join(' · '):'—';}
function change(value:number|null){return value===null?'暂无对比':`${value>0?'+':''}${value}% 较上一周期`;}
export function Dashboard({data,name}:{data:BosOverview;name:string}){
 const date=new Intl.DateTimeFormat('zh-CN',{dateStyle:'full',timeZone:data.timezone}).format(new Date(data.generatedAt));
 const cards=[
  {label:'今日新增客户',value:String(data.newToday),detail:change(data.newChange),href:'/crm'},
  {label:'广告投入',value:displayMoney(data.adSpendToday),detail:`本月 ${displayMoney(data.adSpendMonth)}`,href:'/growth'},
  {label:'报价金额',value:displayMoney(data.quoteAmount),detail:'今日已发送报价 · 数量 × 单价',href:'/sales'},
  {label:'成交金额',value:displayMoney(data.dealAmount),detail:'本月成交 · 保留原币种',href:'/orders'},
 ];
 return <div className="bos-v2-page">
  <header className="bos-v2-hero"><div><span className="bos-v2-kicker">DASHBOARD / 经营驾驶舱</span><h1>{greeting(new Date(data.generatedAt),data.timezone)}, {name}</h1><p>{date} · {data.scope}视图。先看经营状态，再决定今天的行动。</p></div><Link className="bos-v2-primary" href="/tasks">打开今日行动 <ArrowUpRight size={16}/></Link></header>
  <section className="bos-v2-metrics" aria-label="核心经营指标">{cards.map(card=><Link className="bos-v2-metric" href={card.href} key={card.label}><span>{card.label}<ArrowUpRight size={15}/></span><strong>{card.value}</strong><small>{card.detail}</small></Link>)}</section>
  <div className="bos-v2-status-strip"><Link href="/orders"><span>本月订单</span><strong>{data.monthOrders} 笔</strong><ArrowUpRight size={14}/></Link>{data.scope==='团队'&&<Link href="/finance"><span>本月毛利润</span><strong>{displayMoney(data.grossProfit)}</strong><ArrowUpRight size={14}/></Link>}<Link href="/tasks"><span>今日待跟进</span><strong>{data.followUps} 位客户</strong><ArrowUpRight size={14}/></Link></div>
  <div className="bos-v2-dashboard-grid">
   <section className="bos-v2-surface"><div className="bos-v2-section-head"><div><span className="bos-v2-kicker">THE JOURNEY</span><h2>经营漏斗</h2><p>最近 30 天 · 相邻阶段转化参考</p></div><Link href="/growth" className="bos-v2-text-link">查看增长分析 <ArrowUpRight size={15}/></Link></div><div className="bos-v2-funnel">{data.funnel.map((step,index)=><div className="bos-v2-funnel-row" key={step.label}><span className="bos-v2-funnel-index">0{index+1}</span><div className="bos-v2-funnel-name"><strong>{step.label}</strong><small>{step.source}</small></div><div className="bos-v2-funnel-bar"><i style={{width:`${Math.max(3,Math.min(100,step.count/(data.funnel[0].count||1)*100))}%`}}/></div><strong className="bos-v2-funnel-number">{step.count.toLocaleString()}</strong><span className="bos-v2-funnel-rate">{step.rate===null?'—':`${step.rate}%`}</span><span className={`bos-v2-trend ${step.trend!==null&&step.trend<0?'is-down':''}`}>{step.trend===null?'—':`${step.trend>0?'+':''}${step.trend}%`}</span></div>)}</div><p className="bos-v2-note">广告曝光与点击来自已同步广告，询盘及后续来自 CRM。阶段并非同一批客户的归因漏斗，跨来源的转化率仅供定位问题；“—”表示缺少可比数据。</p></section>
   <section className="bos-v2-surface bos-v2-assistant"><div className="bos-v2-section-head"><div><span className="bos-v2-kicker">YOUR BRIEFING</span><h2><Sparkles size={20}/> 今日经营建议</h2><p>基于任务、报价和广告记录主动整理</p></div></div><div className="bos-v2-assistant-intro"><strong>Good Morning, {name}</strong><span>{data.followUps} 位客户需要跟进</span></div><div className="bos-v2-advice-list">{data.suggestions.map((suggestion,index)=><Link href={suggestion.href} key={`${suggestion.title}-${index}`}><span className="bos-v2-advice-number">0{index+1}</span><div><strong>{suggestion.title}</strong><p>{suggestion.detail}</p></div><ArrowRight size={16}/></Link>)}</div><p className="bos-v2-note">当前建议由业务规则生成。广告变化只在有可比数据时提示。</p></section>
  </div>
  <div className="bos-v2-next"><Link href="/growth">广告是否有效 <ArrowUpRight size={15}/></Link><Link href="/crm">哪些客户要推进 <ArrowUpRight size={15}/></Link>{data.scope==='团队'&&<Link href="/finance">利润情况 <ArrowUpRight size={15}/></Link>}<Link href="/command-center/legacy">历史销售分析 <ArrowUpRight size={15}/></Link></div>
 </div>;
}
