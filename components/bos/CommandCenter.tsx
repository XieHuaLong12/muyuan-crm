import Link from 'next/link';
import { ArrowUpRight,Sparkles,ArrowRight } from 'lucide-react';
import { Card,Header,Badge } from '@/components/ui/bos';
import { channelLabels,greeting,CommandData } from '@/lib/bos';
import { Funnel,Analytics } from '@/components/dashboard';
import type { Dashboard } from '@/lib/types';
import { money } from '@/lib/client';
export function CommandCenter({data,name,analytics,period,currency}:{data:CommandData;name:string;analytics?:Dashboard;period?:string;currency?:string}){const now=new Date(data.generatedAt);const max=Math.max(1,...data.funnel.map(s=>s.count));return <>
 <Header eyebrow="COMMAND CENTER · 老板驾驶舱" title={`${greeting(now,data.timezone)}, ${name}`} description={`${new Intl.DateTimeFormat('zh-CN',{dateStyle:'full',timeZone:data.timezone}).format(now)} · ${data.scope==='TEAM'?'团队经营概览':'个人经营概览'}`} actions={<Link className="bos-button bos-button-primary" href="/sales">进入销售工作台 <ArrowUpRight size={15}/></Link>}/>
 <div className="bos-metrics">{[{label:'今日新增客户',value:data.newLeads,detail:'今日创建的客户',href:'/growth?tab=leads'},{label:'待跟进客户',value:data.followUps,detail:'截至今日 · 含逾期',href:'/sales?queue=today'},{label:'本月报价',value:data.quotes,detail:'本月创建的报价单',href:'/sales?queue=recent'},{label:'本月成交金额',value:data.revenue.length?null:'—',detail:'按实际成交币种',href:'/analytics'},{label:'本月订单',value:data.orders,detail:'已登记成交订单',href:'/analytics'}].map(item=><Card className="bos-metric" key={item.label}><Link href={item.href}><span>{item.label}<ArrowUpRight size={13}/></span>{item.value!==null?<strong>{item.value}</strong>:<div className="bos-revenue">{data.revenue.map(r=><strong key={r.currency}>{money(r.amount,r.currency)}</strong>)}</div>}<small>{item.detail}</small></Link></Card>)}</div>
 <div className="bos-command-grid"><Card className="bos-funnel"><div className="bos-section-title"><div><h2>每一步，都在向前</h2><p>销售漏斗 · 当前客户阶段分布</p></div><Badge>LIVE CRM</Badge></div><div className="bos-funnel-chart">{data.funnel.map((s,i)=><div key={s.key} className="bos-funnel-step"><div className="bos-funnel-count">{s.count}{i<data.funnel.length-1&&<ArrowRight size={14}/>}</div><div className="bos-funnel-track"><div style={{height:`${Math.max(3,s.count/max*100)}%`,opacity:.3+i*.14}}/></div><strong>{s.label}</strong><small>{s.title}</small></div>)}</div><p className="bos-footnote">阶段为互斥分布，并非历史转化率。暂停、无效、流失等其他状态：{data.excludedStages} 位。</p></Card>
 <Card className="bos-business-ai"><div className="bos-section-title"><div><span className="bos-ai-symbol"><Sparkles size={18}/></span><h2>AI Business Assistant</h2><p>今日建议 · 基于 CRM 规则</p></div></div><div className="bos-suggestions">{data.suggestions.map((s,i)=><Link key={s.id} href={s.href}><span className="bos-suggestion-number">0{i+1}</span><div><strong>{s.title}</strong><p>{s.detail}</p></div><ArrowUpRight size={15}/></Link>)}</div><p className="bos-footnote">业务助手 v1 使用真实跟进与报价记录；广告成本趋势将在渠道接入后提供。</p></Card></div>
 <Card className="bos-marketing-overview"><div className="bos-section-title"><div><h2>增长，从清晰开始</h2><p>运营数据 · 渠道 API 尚未接入</p></div><Link href="/growth" className="bos-text-link">打开运营中心 <ArrowUpRight size={14}/></Link></div><div className="bos-channel-grid">{data.channels.map(c=><div key={c.channel}><div><span className="bos-channel-monogram">{channelLabels[c.channel].slice(0,1)}</span><strong>{channelLabels[c.channel]}</strong><Badge>未连接</Badge></div><dl><div><dt>广告花费</dt><dd>—</dd></div><div><dt>广告 Leads</dt><dd>—</dd></div><div><dt>CPL</dt><dd>—</dd></div></dl></div>)}</div></Card>
 {analytics&&<>
  <section className="bos-section-title" id="analytics" style={{marginTop:40}}>
   <div>
    <span className="bos-eyebrow">DETAILED ANALYTICS</span>
    <h2>销售分析</h2>
    <p>销售与毛利趋势、询盘进展、客户来源表现、国家分布，以及按<strong>历史阶段流转</strong>统计的转化漏斗（原先的「数据分析」与「销售漏斗」两个页面）</p>
   </div>
   <nav className="bos-segmented" aria-label="统计周期与币种">
    {([['WEEK','本周'],['MONTH','本月'],['YEAR','本年']] as const).map(([k,label])=><Link key={k} href={`/command-center?period=${k}&currency=${currency}#analytics`} aria-current={period===k?'page':undefined}>{label}</Link>)}
    {([['CNY','¥'],['USD','$'],['EUR','€']] as const).map(([k,label])=><Link key={k} href={`/command-center?period=${period}&currency=${k}#analytics`} aria-current={currency===k?'page':undefined}>{label}</Link>)}
   </nav>
  </section>
  <div className="v3-legacy bos-analytics"><Funnel data={analytics} compact/><Analytics data={analytics}/></div>
 </>}
 </>;}
