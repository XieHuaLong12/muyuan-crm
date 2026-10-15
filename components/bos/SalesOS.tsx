'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight,ArrowLeft,ArrowRight } from 'lucide-react';
import { Header,Search,Button,Badge,Card,EmptyState } from '@/components/ui/bos';
import { FollowForm } from '@/components/forms';
import type { Bootstrap,Customer } from '@/lib/types';
import type { SalesQueueData } from '@/services/bos-sales-service';
import { api,dateTimeText } from '@/lib/client';
import { sources,stages } from '@/lib/constants';
const queueNames={today:'今日待办',new:'新分配 · 待首联',waiting:'待回复客户',high:'重点客户',recent:'全部客户'};
const descriptions={new:'先联系新分配客户（按优先级排序，A 级和快超时的在前），再记录联系结果与下一次跟进时间。',today:'待首联、今天到期和已经逾期的跟进与待办都在这里。按优先级排序：已超时的、客户在等你回复的、A 级线索排在前面，每行写着原因。',waiting:'这些客户有新的回复，请在日常沟通工具中处理并登记跟进。',high:'查看已有评分与采购意向，安排下一步跟进。',recent:'查找自己负责的客户，打开档案维护资料、报价与成交。'};
export function SalesOS({data,boot}:{data:SalesQueueData;boot:Bootstrap}){
 const router=useRouter(),[follow,setFollow]=useState<Customer|null>(null),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 const admin=boot.user.role==='ADMIN';
 const href=(patch:Record<string,string>)=>`/sales?${new URLSearchParams({queue:data.query.queue,q:data.query.q,page:String(data.query.page),...patch})}`;
 const ranked=data.query.queue==='today'||data.query.queue==='new';
 async function record(id:string){setBusy(id);setError('');try{setFollow(await api<Customer>(`customers/${id}`));}catch(e){setError((e as Error).message);}finally{setBusy(null);}}
 return <div className="bos-sales-list-page"><Header title={admin?'团队跟进队列':'今日工作'} description={admin?'查看各销售待首联、到期跟进与待回复的客户。':'联系客户后点「记录跟进」，填写结果和下次跟进时间，这一项就会从今日待办中移走。'}/>
 <Card><div className="bos-sales-list-toolbar"><nav className="bos-tabs" aria-label="客户跟进筛选">{data.counts.map(c=><Link key={c.key} href={href({queue:c.key,page:'1'})} aria-current={data.query.queue===c.key?'page':undefined}>{queueNames[c.key]} <span>{c.count}</span></Link>)}</nav><form action="/sales"><input type="hidden" name="queue" value={data.query.queue}/><Search name="q" defaultValue={data.query.q} label="搜索待跟进客户" placeholder="客户、公司或国家"/><Button type="submit">搜索</Button></form></div><p className="bos-footnote">{descriptions[data.query.queue]}</p>
 <div className="bos-sales-list">{data.customers.map(c=>{const deadline=c.firstContactDueAt&&!c.firstContactAt?c.firstContactDueAt:c.nextFollowUpAt;const overdue=[deadline,...c.dueTasks.map(t=>t.dueDate)].some(d=>!!d&&new Date(d)<new Date());return <article key={c.id} className="bos-sales-list-row"><div className="bos-sales-list-customer"><Link href={`/customers/${c.id}`}><strong>{c.name}</strong><ArrowUpRight size={14}/></Link><p>{c.companyName||'公司待补充'} · {c.country||'国家待补充'}</p><small>{sources[c.source as keyof typeof sources]||c.source} · {c.productInterest||'产品需求待确认'}</small>{ranked&&!!c.reasons.length&&<div className="bos-sales-reasons" aria-label="排在这里的原因">{c.reasons.map(r=><span key={r} className={/超时|等回复/.test(r)?'is-hot':r.startsWith('A ')?'is-good':undefined}>{r}</span>)}</div>}</div><div className="bos-sales-list-status"><Badge tone={overdue?'warning':'neutral'}>{overdue?'已逾期':stages[c.stage as keyof typeof stages]||c.stage}</Badge><small>{deadline?`${c.firstContactDueAt&&!c.firstContactAt?'首联期限':'下次跟进'} ${dateTimeText(deadline,boot.settings.timezone)}`:'下次跟进时间待登记'}</small>{c.dueTasks.map(t=><small key={t.title} className="bos-sales-list-task">待办：{t.title} · {dateTimeText(t.dueDate,boot.settings.timezone)}</small>)}</div><div className="bos-sales-list-actions"><Button variant="primary" disabled={busy===c.id} onClick={()=>record(c.id)}>{busy===c.id?'读取中…':'记录跟进'}</Button><Link className="bos-button" href={`/customers/${c.id}`}>客户档案</Link></div></article>;})}</div>
 {!data.customers.length&&<EmptyState title={data.query.queue==='today'?'今天的工作都完成了':'暂无待处理客户'} description="尝试其他筛选，或查看全部客户。" action={<Link className="bos-button" href="/customers">{admin?'客户列表':'我的客户'}</Link>}/>}
 <div className="bos-pagination"><span>共 {data.total} 位 · 第 {data.query.page} 页</span><div>{data.query.page>1&&<Link className="bos-button" aria-label="上一页客户" href={href({page:String(data.query.page-1)})}><ArrowLeft size={15}/>上一页</Link>}{data.query.page*data.pageSize<data.total&&<Link className="bos-button" aria-label="下一页客户" href={href({page:String(data.query.page+1)})}>下一页<ArrowRight size={15}/></Link>}</div></div></Card>
 {error&&<p className="bos-sales-error" role="alert">{error}</p>}{follow&&<FollowForm customer={follow} timezone={boot.settings.timezone} onClose={()=>setFollow(null)} onSaved={()=>{setFollow(null);router.refresh();}}/>}</div>;
}
