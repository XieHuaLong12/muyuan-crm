'use client';
import { useEffect,useState } from 'react';
import { Card,Table,Button,Input,EmptyState,Skeleton } from '@/components/ui/bos';
import type { identityReview } from '@/services/identity-chain-service';
type Review=Awaited<ReturnType<typeof identityReview>>;
export function IdentityRepairPanel({admin}:{admin:boolean}){
  const [data,setData]=useState<Review|null>(null),[error,setError]=useState(''),[q,setQ]=useState(''),[page,setPage]=useState(1),[reason,setReason]=useState(''),[targets,setTargets]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false);
  async function refresh(){const response=await fetch(`/api/identity-chain/review?${new URLSearchParams({q,page:String(page)})}`,{cache:'no-store'});const body=await response.json();if(!body.success)throw new Error(body.error||'读取失败');setData(body.data);}
  useEffect(()=>{const controller=new AbortController();fetch(`/api/identity-chain/review?page=${page}`,{signal:controller.signal,cache:'no-store'}).then(r=>r.json()).then(body=>{if(!body.success)throw new Error(body.error);setData(body.data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[page]);
  async function claim(key:string,kind:'message'|'lead'){
    setBusy(true);setError('');try{const response=await fetch('/api/identity-chain/claim',{method:kind==='lead'?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(kind==='lead'?{leadKey:key}:{itemId:key}),customerId:targets[key],reason})});const body=await response.json();if(!body.success)throw new Error(body.error||'认领失败');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const choose=(key:string,kind:'message'|'lead')=><><select aria-label="人工选择正确客户" value={targets[key]||''} onChange={e=>setTargets({...targets,[key]:e.target.value})}><option value="">选择已核对客户</option>{data?.customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.whatsapp||c.phone} · {c.companyName}</option>)}</select><Button disabled={busy||!targets[key]||!reason.trim()} onClick={()=>claim(key,kind)}>确认归属</Button></>;
  return <Card><h2>身份待认领</h2><p>先搜索并核对客户，再填写理由确认归属。此操作保留审计记录，历史消息和订单来源不会被搬移。</p>
    <form className="identity-filters" onSubmit={e=>{e.preventDefault();refresh().catch(e=>setError(e.message));}}><label>搜索客户/国际电话<Input value={q} onChange={e=>setQ(e.target.value)} placeholder="姓名、公司、邮箱或 +971…"/></label><Button type="submit">搜索客户</Button><label>人工确认理由<Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="核对依据"/></label></form>
    {error&&<p role="alert">{error}</p>}{!data?<Skeleton/>:<>
    {data.messages.length?<Table caption="待认领 WhatsApp 消息" headings={['号码 / 昵称','消息 / 冲突原因','人工归属']}>{data.messages.map(m=><tr key={m.id}><td>{m.peerPhone||'未知号码'}<br/>{m.peerName}</td><td>{m.content.slice(0,180)}<br/>{m.provider} · {m.reason}</td><td>{choose(m.id,'message')}</td></tr>)}</Table>:<EmptyState title="没有待认领消息" description="未匹配消息会持久保留，待身份确认后补齐。"/>}
    {admin&&(data.leads.length?<Table caption="待认领 Meta 留资" headings={['Lead ID','电话 / 广告','状态 / 人工归属']}>{data.leads.map(l=><tr key={l.id}><td>{l.leadId||l.leadKey}</td><td>{l.phoneRaw||l.emailNormalized||'—'}<br/>{l.adName||'未知广告'}</td><td>{l.status}{choose(l.leadKey,'lead')}</td></tr>)}</Table>:<EmptyState title="没有待认领留资" description="号码冲突的留资不会自动创建或合并客户。"/>)}
    <div className="bos-actions"><Button disabled={page===1||busy} onClick={()=>setPage(page-1)}>上一页</Button><span>第 {page} 页 · 消息 {data.messageTotal} · 留资 {data.leadTotal}</span><Button disabled={page*25>=Math.max(data.messageTotal,data.leadTotal)||busy} onClick={()=>setPage(page+1)}>下一页</Button></div>
    </>}
  </Card>;
}
