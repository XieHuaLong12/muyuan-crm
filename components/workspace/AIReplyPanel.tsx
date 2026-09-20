'use client';
import { useEffect,useRef,useState } from 'react';
import { Sparkles,Copy,Send,RefreshCw,PenLine,Check,ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/client';
import type { Customer } from '@/lib/types';
export function AIReplyPanel({customer,onUse,onSend,sending,canSend}:{customer:Customer;onUse:(text:string)=>void;onSend:(text:string)=>Promise<void>;sending:boolean;canSend:boolean}){
 const [draft,setDraft]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function generate(){setLoading(true);setError('');try{const result=await api<{reply:string}>('whatsapp/ai-reply','POST',{customerId:customer.id});if(alive.current)setDraft(result.reply);}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setLoading(false);}}
 async function copy(){try{await navigator.clipboard.writeText(draft);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{setError('无法访问剪贴板，请选中文字复制。');}}
 return <aside className="v3-ai-panel"><div className="v3-ai-title"><span><Sparkles size={17}/></span><div><h3>AI Reply Assistant</h3><small>让回复更进一步</small></div></div><div className="v3-ai-insight"><span>客户意向</span><strong>{customer.aiIntent==='HIGH'?'高采购意向':customer.aiIntent==='MEDIUM'?'持续了解中':'等待更多线索'}</strong><p>{customer.aiSummary||'AI 会结合最近的对话与客户资料，为你整理回复建议。'}</p><div className="v3-ai-score-line"><span>AI 评分</span><strong>{customer.aiScore||0}<small> / 100</small></strong></div><progress max={100} value={customer.aiScore||0}/></div><div className="v3-ai-draft-heading"><strong>建议回复</strong><button className="v3-icon" aria-label="生成 AI 回复" onClick={generate} disabled={loading}><RefreshCw size={15} className={loading?'v3-spin':''}/></button></div>
 {loading?<div className="v3-draft-skeleton" aria-label="AI 正在生成回复"><div/><div/><div/></div>:<textarea aria-label="AI 建议回复" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="点击生成，获取基于最近 20 条聊天的回复建议。" rows={8}/>}
 {!draft&&<button className="v3-soft-button" onClick={generate} disabled={loading}><Sparkles size={15}/>{loading?'生成中…':'生成建议'}</button>}
 <div className="v3-ai-actions"><button disabled={!draft||loading} onClick={copy}>{copied?<Check size={14}/>:<Copy size={14}/>}复制</button><button disabled={!draft||loading||sending} onClick={()=>onUse(draft)}><PenLine size={14}/>编辑</button></div><button className="primary v3-ai-send" onClick={()=>onSend(draft)} disabled={!draft||loading||sending||!canSend}><Send size={15}/>{sending?'发送中…':'发送此回复'}</button><small className="v3-ai-note">发送前请确认价格、数量和交期。</small>
 <div className="v3-next-action"><span>下一步行动</span><p>{customer.aiNextAction||'确认产品型号、采购数量与目的地。'}</p><a href={`/tasks?customer=${customer.id}&new=1`} className="v3-text-link">创建跟进任务 <ArrowUpRight size={13}/></a></div>{error&&<p className="error" role="alert">{error}</p>}</aside>;
}
