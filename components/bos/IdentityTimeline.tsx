'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import { Card, Button, Badge, EmptyState } from '@/components/ui/bos';
import { IntelligenceReview,type IntelligenceRecord } from './IntelligenceReview';

type Attribution={status:string;campaignId:string|null;adsetId:string|null;adId:string|null;creativeId:string|null;firstLeadKey:string|null;lastLeadKey:string|null};
type Chain={intelligence:IntelligenceRecord|null;customer:{id:string;phoneE164:string|null;stage:string;stageSource:string};leads:{id:string;leadKey:string;occurredAt:string|null;campaignName:string|null;campaignId:string|null;adsetName:string|null;adsetId:string|null;adName:string|null;adId:string|null;creativeName:string|null;creativeId:string|null}[];
  conversations:{id:string;contact:{provider:string;status:string}}[];timeline:{id:string;kind:string;at:string;source:string}[];messages:{id:string;content:string}[];nextCursor:string|null;
  selectedOrder:{id:string;attribution:Attribution|null}|null;orders:{id:string;orderNo:string;attribution:Attribution|null}[]};
const labels:Record<string,string>={CTWA_REFERRAL:'广告来源消息（referral 证据）',LEAD_SUBMISSION:'Meta 留资',INBOUND_MESSAGE:'客户消息',OUTBOUND_MESSAGE:'销售消息',QUOTE_SENT:'报价已发送',ORDER_REGISTERED:'订单登记',CATALOG_SENT:'已发目录',PRODUCT_CONFIRMED:'已确认产品',PAYMENT_RECEIVED:'付款记录',ORDER_COMPLETED:'订单完成'};
const instant=(value:string|null,timezone:string)=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'—';

export function IdentityTimeline({customerId,orderId,timezone}:{customerId?:string;orderId?:string;timezone:string}){
  const [data,setData]=useState<Chain|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const query=new URLSearchParams(orderId?{orderId}:{customerId:customerId!}).toString();
  useEffect(()=>{const controller=new AbortController();setData(null);setError('');fetch(`/api/identity-chain?${query}`,{signal:controller.signal,cache:'no-store'}).then(r=>r.json()).then(body=>{if(!body.success)throw new Error(body.error);if(!controller.signal.aborted)setData(body.data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[query,revision]);
  async function older(){if(!data?.nextCursor)return;setBusy(true);setError('');try{const page=await api<Chain>(`identity-chain?${query}&cursor=${encodeURIComponent(data.nextCursor)}`);setData(old=>old?{...page,timeline:[...new Map([...old.timeline,...page.timeline].map(e=>[`${e.kind}:${e.id}`,e])).values()],messages:[...new Map([...old.messages,...page.messages].map(m=>[m.id,m])).values()]}:page);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Card className="identity-timeline"><div className="bos-section-title"><div><h2>身份链与业务时间线</h2><p>留资 → 国际手机号 → 客户 → 会话 → 订单 → 广告</p></div><Button disabled={busy} onClick={()=>setRevision(v=>v+1)}>刷新</Button></div>
    {error?<p role="alert">{error}</p>:!data?<p role="status">正在读取身份链…</p>:<>
      <p>{data.customer.phoneE164||'手机号待核对'} · 事实阶段 {data.customer.stage} <Badge>{data.customer.stageSource}</Badge> · 已关联会话 {data.conversations.length}</p>
      {data.intelligence&&<IntelligenceReview key={data.intelligence.updatedAt} customerId={data.customer.id} data={data.intelligence} onSaved={()=>setRevision(v=>v+1)}/>}
      <details><summary>广告来源与原始留资（最近 {data.leads.length} 条）</summary>{data.leads.length?data.leads.map(l=><article key={l.id}><strong>{l.leadKey}</strong><p>{instant(l.occurredAt,timezone)}</p><dl>{[['Campaign',l.campaignName,l.campaignId],['Ad Set',l.adsetName,l.adsetId],['Ad',l.adName,l.adId],['Creative',l.creativeName,l.creativeId]].map(([label,name,id])=><div key={label}><dt>{label}</dt><dd>{name||'名称未获取'} · {id||'ID 未获取'}</dd></div>)}</dl></article>):<p>暂无留资归因记录，可在数据质量页面补齐。</p>}</details>
      {(data.selectedOrder?[data.selectedOrder]:data.orders).map(o=><article key={o.id}><Link href={`/orders/detail/${o.id}`}>订单 ↗</Link> <Badge>{o.attribution?.status||'归因尚未补齐'}</Badge><p>固定广告 {o.attribution?.adId||'—'} · 素材 {o.attribution?.creativeId||'—'} · 首次 {o.attribution?.firstLeadKey||'—'} · 末次 {o.attribution?.lastLeadKey||'—'}</p></article>)}
      {data.timeline.length?<ol>{[...data.timeline].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).map(event=><li key={`${event.kind}:${event.id}`}><strong>{labels[event.kind]||event.kind}</strong><small>{instant(event.at,timezone)} · {event.source}</small>{data.messages.find(m=>m.id===event.id)&&<p>{data.messages.find(m=>m.id===event.id)?.content}</p>}</li>)}</ol>:<EmptyState title="暂无业务事件" description="新的留资、已保存消息、正式发送报价和订单会自动显示在这里。"/>}
      {data.nextCursor&&<Button disabled={busy} onClick={older}>{busy?'读取中…':'更早的聊天记录'}</Button>}
    </>}
  </Card>;
}
