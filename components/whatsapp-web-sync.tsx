'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import styles from './whatsapp-web-sync.module.css';

type Device={id:string;label:string;accountPhone:string;createdAt:string;expiresAt:string;revokedAt:string|null;lastUsedAt:string|null};
type Run={id:string;accountPhone:string;success:number;skipped:number;failed:number;unmatched:number;errors:{sourceMessageId?:string;message:string}[];createdAt:string};
type Item={id:string;peerPhone:string|null;peerName:string;direction:string;sentAt:string;content:string;reason:string};
type State={tokens:Device[];runs:Run[];unmatched:Item[];unmatchedTotal:number;lastSyncedAt:string|null};
type Customer={id:string;name:string;phone:string;whatsapp:string;companyName:string};
const time=(s:string|null)=>s?new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short'}).format(new Date(s)):'暂无';

export function WhatsAppWebSync(){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [label,setLabel]=useState('我的浏览器'),[phone,setPhone]=useState(''),[issued,setIssued]=useState<{token:string;device:Device}|null>(null);
 const [q,setQ]=useState(''),[choices,setChoices]=useState<Customer[]>([]),[itemId,setItemId]=useState(''),[claimId,setClaimId]=useState(''),[notice,setNotice]=useState('');
 const searchRevision=useRef(0);
 const refresh=useCallback(async()=>{try{setState(await api<State>('whatsapp/web-sync/state'));setError('');}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void refresh();},[refresh]);
 async function create(){setBusy(true);setError('');try{const result=await api<{token:string;device:Device}>('whatsapp/web-sync/tokens','POST',{label,accountPhone:phone});setIssued(result);setPhone('');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function revoke(id:string){setBusy(true);setError('');try{await api(`whatsapp/web-sync/tokens/${id}`,'DELETE');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function search(query=q){const revision=++searchRevision.current;setClaimId('');setError('');try{const found=await api<Customer[]>(`whatsapp/web-sync/customers?q=${encodeURIComponent(query)}`);if(revision===searchRevision.current)setChoices(found);}catch(e){if(revision===searchRevision.current)setError((e as Error).message);}}
 async function reconcile(){setBusy(true);setError('');setNotice('');try{const result=await api<{imported:number;skipped:number;scanned:number;hasMore:boolean}>('whatsapp/web-sync/reconcile','POST');setNotice(`已按国际号码关联 ${result.imported} 条；${result.skipped} 条仍需人工核对。${result.hasMore?'还有待认领消息，可再次点击。':''}`);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function claim(){if(!itemId||!claimId)return;setBusy(true);setError('');try{await api('whatsapp/web-sync/claim','POST',{itemId,customerId:claimId});setItemId('');setClaimId('');setChoices([]);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className={styles.grid}>
  <section className={styles.main}>
   <div className={styles.card}><div className={styles.heading}><div><h2>待认领消息</h2><p>仅显示你的同步记录。没有唯一手机号的消息在此手动关联，姓名只作参考。</p></div><strong>{state?.unmatchedTotal??0}</strong></div>
    {!!state?.unmatchedTotal&&<div className={styles.reconcile}><button type="button" disabled={busy} onClick={reconcile}>按号码重新匹配</button><small>只自动关联国际号码唯一匹配的客户；不会按姓名合并。</small></div>}
    {notice&&<p className={styles.notice} role="status">{notice}</p>}
    {!state?.unmatched.length&&<p className={styles.empty}>暂无待认领消息。</p>}
    {state?.unmatched.map(m=><div className={styles.item} key={m.id}><div className={styles.itemHead}><strong>{m.peerName||'未知联系人'}</strong><span>{m.peerPhone||'无有效号码'} · {time(m.sentAt)} · {m.direction==='inbound'?'客户发来':'我方发出'}</span></div><p>{m.content?m.content.slice(0,280):'［附件，仅保存元数据］'}</p><small>{m.reason==='AMBIGUOUS'?'多个客户号码相同，需要人工确认':'没有精确匹配的客户'}</small><button type="button" onClick={()=>{const query=m.peerPhone||m.peerName;setItemId(m.id);setClaimId('');setChoices([]);setQ(query);void search(query);}}>关联客户</button></div>)}
    {(state?.unmatchedTotal??0)>100&&<p>此处显示最近 100 条待认领消息。</p>}
    {itemId&&<div className={styles.claim}><h3>选择客户</h3><p>先核实客户身份；搜索结果不会自动关联。输入带或不带 + 的国际号码均可精确检索。</p><div className={styles.row}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="姓名、公司或手机号"/><button onClick={()=>void search()}>搜索</button></div><div className={styles.choices}>{choices.map(c=><label key={c.id}><input type="radio" name="customer" value={c.id} checked={claimId===c.id} onChange={()=>setClaimId(c.id)}/><span><strong>{c.name}</strong> · {c.companyName}<small>{c.whatsapp||c.phone||'无号码'}</small></span></label>)}</div><div className={styles.row}><button disabled={busy||!claimId} onClick={claim}>确认关联</button><button onClick={()=>setItemId('')}>取消</button></div></div>}
   </div>
   <div className={styles.card}><div className={styles.heading}><div><h2>同步记录</h2><p>最近同步：{time(state?.lastSyncedAt||null)}</p></div><button onClick={()=>void refresh()}>刷新</button></div>{!state?.runs.length&&<p className={styles.empty}>还没有同步记录。</p>}{state?.runs.map(r=><div className={styles.run} key={r.id}><div><strong>{time(r.createdAt)}</strong><span>{r.accountPhone}</span></div><p>成功 {r.success} · 跳过 {r.skipped} · 待认领 {r.unmatched} · 失败 {r.failed}</p>{r.errors.length>0&&<details><summary>查看错误</summary>{r.errors.map((e,i)=><p key={i}>{e.sourceMessageId?`${e.sourceMessageId.slice(0,40)}：`:''}{e.message}</p>)}</details>}</div>)}</div>
  </section>
  <aside className={styles.side}><div className={styles.card}><h2>连接浏览器扩展</h2><p>扩展只读取你在 WhatsApp Web 已打开标签页中当前加载的消息。需由你点击“预览”或“同步”；不会自动翻页。</p><ol><li>在下方创建 30 天有效的同步授权。</li><li>将扩展目录加载到 Chrome/Edge。</li><li>把 CRM 地址、授权码和你当前登录的 WhatsApp 账号号码填入扩展。</li></ol><p>切换 WhatsApp 账号时，先更换授权。CRM 不接收 WhatsApp 密码或登录会话。</p><label>设备名称<input value={label} onChange={e=>setLabel(e.target.value)} maxLength={80}/></label><label>本人 WhatsApp 国际号码<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+8613812345678"/></label><button disabled={busy||!phone||!label.trim()} onClick={create}>创建授权</button>{issued&&<div className={styles.token}><strong>只显示一次，请立即复制到扩展</strong><code>{issued.token}</code><button onClick={()=>void navigator.clipboard.writeText(issued.token)}>复制授权码</button><small>绑定 {issued.device.accountPhone} · {time(issued.device.expiresAt)} 到期</small></div>}</div><div className={styles.card}><h2>已授权设备</h2>{!state?.tokens.length&&<p>暂无设备。</p>}{state?.tokens.map(t=><div className={styles.device} key={t.id}><strong>{t.label}</strong><small>{t.accountPhone} · {t.revokedAt?'已撤销':new Date(t.expiresAt)<new Date()?'已过期':`有效至 ${time(t.expiresAt)}`}</small><small>最近使用：{time(t.lastUsedAt)}</small>{!t.revokedAt&&<button disabled={busy} onClick={()=>void revoke(t.id)}>撤销</button>}</div>)}</div></aside>
  {error&&<p className={styles.error} role="alert">{error}</p>}
 </div>;
}
