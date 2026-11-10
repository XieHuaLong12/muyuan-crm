'use client';
import { useEffect,useState,type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpDown,Check,ChevronDown,Copy,MessageCircle,MessageSquare,PanelRightOpen } from 'lucide-react';
import { Customer } from '@/lib/types';
import { stages,sources,purchases,invalidReasons,stageQualifies } from '@/lib/constants';
import { KANBAN_REASON_STAGES,KANBAN_STAGES,type KanbanStage } from '@/lib/bos-kanban';
import { api,money,dateText,dateTimeText } from '@/lib/client';
import { dayKey } from '@/lib/time';
import { DEFAULT_WORK_HOURS,entryLabel,entryOf,inWorkHours,type WorkHours } from '@/lib/entry-time';
import { ReasonDialog } from './forms';
import { LEAD_GRADES,isLeadGrade } from '@/lib/lead-grade';
import { CUSTOMER_COLUMNS,DEFAULT_CUSTOMER_COLUMNS,type CustomerColumnKey } from '@/lib/customer-columns';
/** The ad-form grade, with what it was based on as a tooltip. */
export function GradeChip({grade,reason,source}:{grade?:string;reason?:string;source?:string}){if(!grade||!isLeadGrade(grade))return null;return <span className={`grade-chip grade-${grade.toLowerCase()}`} title={`${LEAD_GRADES[grade].label}${reason?`：${reason}`:''}${source==='AI'?'（AI 评级）':source==='RULE'?'（按表单规则）':''}`} aria-label={`表单等级 ${LEAD_GRADES[grade].label}`}>{grade}</span>;}
export function Badge({stage}:{stage:string}){return <span className={`badge badge-${stage.toLowerCase()}`}>{stages[stage as keyof typeof stages]??stage}</span>;}
export function Due({date,tz}:{date:string|null;tz:string}){if(!date)return <span className="muted">未安排</span>;const key=dayKey(date,tz),today=dayKey(new Date(),tz),days=Math.round((Date.parse(today)-Date.parse(key))/86400000);return <span className={days>0?'overdue':days===0?'due-today':'muted'}>{days>0?`已超时 ${days} 天`:days===0?'今日跟进':dateText(date,tz)}</span>;}
/** Minutes or hours a pooled lead has been waiting for an owner. */
const waited=(since:string)=>{const m=Math.max(0,Math.floor((Date.now()-Date.parse(since))/60000));return m<60?`${m} 分钟`:m<1440?`${Math.floor(m/60)} 小时`:`${Math.floor(m/1440)} 天`;};

/** Clipboard API where allowed, otherwise the selection fallback (older browsers, non-HTTPS previews). */
async function copyText(text:string){
 try{await navigator.clipboard.writeText(text);return true;}catch{
  const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
  document.body.appendChild(area);area.select();const ok=document.execCommand('copy');area.remove();return ok;
 }
}

/** The number to follow up on: one click copies it, the chat icon opens the WhatsApp conversation. */
function ContactCell({c}:{c:Customer}){
 const [copied,setCopied]=useState(false);const n=c.contact;
 if(!n)return <span className="muted">—</span>;
 return <span className="contact-cell">
  <button type="button" className="contact-copy" title={`点击复制 ${n.copy}`} aria-label={`复制号码 ${n.display}`}
   onClick={async()=>{if(await copyText(n.copy)){setCopied(true);setTimeout(()=>setCopied(false),1500);}}}>
   <span>{n.display}</span>{copied?<Check size={13} aria-hidden/>:<Copy size={13} aria-hidden/>}
  </button>
  {n.chat&&<a className="contact-chat" href={n.chat} target="_blank" rel="noreferrer" title="在 WhatsApp 中打开聊天" aria-label={`在 WhatsApp 中与 ${c.name} 聊天`}><MessageCircle size={15}/></a>}
  {n.kind==='PHONE'&&<small className="muted" title="客户没有单独填写 WhatsApp，这是联系电话">电话</small>}
  <span className="visually-hidden" aria-live="polite">{copied?'已复制':''}</span>
 </span>;
}

/**
 * Change the stage straight from the list, with the kanban's rules: paused / lost / invalid ask for a reason, and a
 * customer is only won through a deal (so won customers keep a plain badge).
 */
function StageCell({c,onChanged}:{c:Customer;onChanged?:(message:string)=>void}){
 const [asking,setAsking]=useState<KanbanStage>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // The chosen stage stays visible while the list reloads; a fresh stage from the server replaces it.
 const [chosen,setChosen]=useState<string>();
 useEffect(()=>{setChosen(undefined);},[c.stage]);
 if(!onChanged||c.stage==='WON'||c.deals?.length)return <span title={c.stage==='WON'?'成交客户的阶段随成交记录变化':undefined}><Badge stage={c.stage}/></span>;
 const label=(key:string)=>stages[key as keyof typeof stages]??key;
 const shown=chosen??c.stage;
 // Errors surface where the change was made: in the reason dialog, or under the stage.
 const move=async(toStage:KanbanStage,reason='')=>{
  setBusy(true);setError('');
  try{await api('bos/crm-stage','PATCH',{customerId:c.id,fromStage:c.stage,toStage,reason});setChosen(toStage);setAsking(undefined);onChanged(`${c.name} 已改为「${label(toStage)}」`);}
  finally{setBusy(false);}
 };
 return <span className="stage-cell">
  <span className={`badge badge-${shown.toLowerCase()} stage-badge`} title="点击修改阶段">
   <select className="stage-select" value={shown} disabled={busy} aria-label={`修改 ${c.name} 的阶段`}
    onChange={e=>{const to=e.target.value as KanbanStage;if(KANBAN_REASON_STAGES.includes(to))setAsking(to);else move(to).catch(err=>setError((err as Error).message));}}>
    {KANBAN_STAGES.map(s=><option key={s.key} value={s.key} disabled={s.key==='WON'}>{s.key==='WON'?`${s.label}（新增成交后自动）`:s.label}</option>)}
    {!KANBAN_STAGES.some(s=>s.key===shown)&&<option value={shown}>{label(shown)}</option>}
   </select>
   <ChevronDown size={11} aria-hidden/>
  </span>
  {error&&<small role="alert" className="stage-error">{error}</small>}
  {asking&&<ReasonDialog title={`改为「${label(asking)}」· ${c.name}`} confirmText="确认修改" label="原因"
   description={<p>管理员会看到这个原因，用于复核对客户的判断。</p>}
   onClose={()=>setAsking(undefined)} onConfirm={reason=>move(asking,reason)}/>}
 </span>;
}

const qualificationLabel=(value:boolean|null)=>value===null?'待判断':value?'有效':'无效';
/**
 * 有效 / 无效 / 待判断 straight from the list, with the customer form's rules: 无效 asks for a reason; a won customer is
 * always valid, and a customer in the 「无效客户」 stage stays invalid until the stage changes.
 */
function QualificationCell({c,onChanged}:{c:Customer;onChanged?:(message:string)=>void}){
 const [asking,setAsking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // The chosen value stays visible while the list reloads; a fresh value from the server replaces it.
 const [chosen,setChosen]=useState<{value:boolean|null}>();
 useEffect(()=>{setChosen(undefined);},[c.isQualified]);
 const shown=chosen?chosen.value:c.isQualified;
 const plain=(title?:string,value=shown)=><span className={value?'qualified':'muted'} title={title}>{qualificationLabel(value)}</span>;
 // 已回复 to 确认采购: valid by stage, set by the system (lib/constants QUALIFYING_STAGES), nothing to click.
 if(stageQualifies(c.stage))return plain(`「${stages[c.stage as keyof typeof stages]}」阶段自动算有效客户；确实无效请把阶段改为「无效客户」`,true);
 if(!onChanged)return plain();
 if(c.stage==='WON'||c.deals?.length)return plain('成交客户一定是有效客户');
 if(c.stage==='INVALID')return plain('阶段是「无效客户」：先把阶段改回其他阶段，才能修改有效性');
 const save=async(to:boolean|null,reason='')=>{
  setBusy(true);setError('');
  try{await api(`customers/${c.id}/qualification`,'PATCH',{from:c.isQualified,to,reason});setChosen({value:to});setAsking(false);onChanged(`${c.name} 已标记为「${qualificationLabel(to)}」`);}
  finally{setBusy(false);}
 };
 return <span className="stage-cell">
  <span className={`badge stage-badge ${shown===null?'qualify-pending':shown?'qualify-yes':'qualify-no'}`} title="点击修改有效性">
   <select className="stage-select" value={shown===null?'':String(shown)} disabled={busy} aria-label={`修改 ${c.name} 的有效性`}
    onChange={e=>{const to=e.target.value===''?null:e.target.value==='true';if(to===false)setAsking(true);else save(to).catch(err=>setError((err as Error).message));}}>
    <option value="">待判断</option><option value="true">有效</option><option value="false">无效</option>
   </select>
   <ChevronDown size={11} aria-hidden/>
  </span>
  {error&&<small role="alert" className="stage-error">{error}</small>}
  {asking&&<ReasonDialog title={`标记为无效 · ${c.name}`} confirmText="确认标记" label="无效原因" suggestions={invalidReasons}
   description={<p>无效客户不计入有效率；原因会显示在客户档案里，方便管理员复核。</p>}
   onClose={()=>setAsking(false)} onConfirm={reason=>save(false,reason)}/>}
 </span>;
}

/** Full date for facts that may be from another year (inquiry, first contact…). */
const fullDate=(value:string|null|undefined,tz:string)=>value?new Date(value).toLocaleDateString('zh-CN',{timeZone:tz}):'—';
const text=(value:string|number|null|undefined)=>value===null||value===undefined||value===''?'—':value;
/** Unset amounts stay unknown instead of showing ¥0. */
const amount=(value:string,currency:string)=>Number(value)?money(value,currency):'—';
/** Long free text stays on one line; the whole text is in the tooltip. */
function Clamp({value}:{value:string}){return value?<span className="cell-clamp" title={value}>{value}</span>:<span className="muted">—</span>;}

type CellContext={tz:string;hours:WorkHours;onChanged?:(message:string)=>void};

/**
 * 进线时间 (lib/entry-time): the company's time, the customer's own time under it, and whether it came in outside the
 * working hours. A date without a clock time shows the date only; a record with no inquiry time is marked 估算.
 */
export function EntryCell({c,tz,hours}:{c:Customer;tz:string;hours:WorkHours}){
 const entry=entryOf({inquiryAt:c.inquiryAt?new Date(c.inquiryAt):null,createdAt:new Date(c.createdAt)},tz);
 // The customer's own zone comes with the row (services/customer-list-service): phone parsing stays on the server.
 const zone=c.entryZone??null;
 const off=entry.exact&&!inWorkHours(entry.at,tz,hours);
 return <span className="entry-cell">
  <span><strong>{entryLabel(entry.at,tz,entry.exact)}</strong>{off&&<em className="entry-off" title={`在工作时间 ${hours.start}:00–${hours.end}:00 之外进线`}>工作时间外</em>}{entry.estimated&&<em className="entry-estimated" title="没有询盘时间，用录入系统的时间代替">估算</em>}</span>
  {entry.exact&&zone&&zone!==tz&&<small>当地 {entryLabel(entry.at,zone)}</small>}
 </span>;
}
/** How each column the user can pick in 「定制列」 renders; labels, groups and sorting live in lib/customer-columns.ts. */
const CELLS:Record<Exclude<CustomerColumnKey,'name'>,(c:Customer,ctx:CellContext)=>ReactNode>={
 companyName:c=><Clamp value={c.companyName}/>,
 country:c=>text(c.country),
 city:c=>text(c.city),
 language:c=>text(c.language),
 purchaseType:c=>purchases[c.purchaseType as keyof typeof purchases]??text(c.purchaseType),
 productInterest:c=><Clamp value={c.productInterest}/>,
 productModel:c=><Clamp value={c.productModel}/>,
 quantity:c=>c.quantity||'—',
 purchaseTimeline:c=><Clamp value={c.purchaseTimeline}/>,
 notes:c=><Clamp value={c.notes}/>,
 whatsapp:c=><ContactCell c={c}/>,
 phone:c=>text(c.phone),
 email:c=>text(c.email),
 stage:(c,{onChanged})=><StageCell c={c} onChanged={onChanged}/>,
 isQualified:(c,{onChanged})=><QualificationCell c={c} onChanged={onChanged}/>,
 leadGrade:c=>isLeadGrade(c.leadGrade??'')?<GradeChip grade={c.leadGrade} reason={c.leadGradeReason} source={c.leadGradeSource}/>:<span className="muted">未评级</span>,
 estimatedOrderValue:c=>money(c.estimatedOrderValue,c.currency),
 budget:c=>amount(c.budget,c.currency),
 quotedAmount:c=>amount(c.quotedAmount,c.currency),
 deals:c=>c.deals.length?`${c.deals.length} 笔`:'—',
 aiScore:c=>c.aiLastAnalyzedAt?`${c.aiScore??0} / 100`:'—',
 inquiryAt:(c,{tz,hours})=><EntryCell c={c} tz={tz} hours={hours}/>,
 createdAt:(c,{tz})=>fullDate(c.createdAt,tz),
 contactedAt:(c,{tz})=>fullDate(c.contactedAt,tz),
 firstReplyAt:(c,{tz})=>fullDate(c.firstReplyAt,tz),
 quotedAt:(c,{tz})=>fullDate(c.quotedAt,tz),
 lastFollowUpAt:(c,{tz})=>dateText(c.lastFollowUpAt,tz),
 nextFollowUpAt:(c,{tz})=><Due date={c.nextFollowUpAt} tz={tz}/>,
 lastWhatsAppAt:(c,{tz})=>dateTimeText(c.lastWhatsAppAt,tz),
 source:c=>sources[c.source as keyof typeof sources]??text(c.source),
 sourceDetail:c=><Clamp value={c.sourceDetail}/>,
 owner:c=>c.pendingAssignment?<span className="badge" title="进入待分配池的时间起算">待分配 · 已等 {waited(c.createdAt)}</span>:c.owner?.name,
};

/** The name opens the customer's profile; anywhere else in this cell (or the preview button) opens the side preview. */
function CustomerCell({c,onPreview}:{c:Customer;onPreview?:(c:Customer,fromKeyboard?:boolean)=>void}){
 return <div className="customer-link">
  <span className="avatar" aria-hidden>{c.name.slice(0,1)}</span>
  <span><strong><Link className="customer-name" href={`/customers/${c.id}`}>{c.name}</Link><GradeChip grade={c.leadGrade} reason={c.leadGradeReason} source={c.leadGradeSource}/></strong><small>{c.companyName||'未填写公司'}</small></span>
  {onPreview&&<button type="button" className="customer-preview-button" title="预览" aria-label={`预览 ${c.name}`} onClick={e=>onPreview(c,e.detail===0)}><PanelRightOpen size={14} aria-hidden/></button>}
 </div>;
}

export function CustomerTable({rows,tz,hours=DEFAULT_WORK_HOURS,columns=DEFAULT_CUSTOMER_COLUMNS,onFollow,onSort,onChanged,onPreview,previewId,selection}:{
 rows:Customer[];tz:string;hours?:WorkHours;columns?:readonly CustomerColumnKey[];onFollow:(c:Customer)=>void;onSort?:(key:string)=>void;onChanged?:(message:string)=>void;
 onPreview?:(c:Customer,fromKeyboard?:boolean)=>void;previewId?:string;selection?:{header:ReactNode;cell:(c:Customer)=>ReactNode};
}){
 const ctx:CellContext={tz,hours,onChanged};
 // Clicks on the name link, the preview button or the checkbox keep their own meaning.
 const previewFromCell=(c:Customer)=>(e:React.MouseEvent)=>{if(!(e.target as HTMLElement).closest('a,button,input,select,label'))onPreview?.(c);};
 return <div className="table-scroll"><table>
  <thead><tr>
   {selection&&<th className="selection-cell">{selection.header}</th>}
   {columns.map(key=>{const {label,sortable}=CUSTOMER_COLUMNS[key];return <th key={key} scope="col">{onSort&&sortable?<button className="sort" onClick={()=>onSort(key)}>{label}<ArrowUpDown size={12}/></button>:label}</th>;})}
   <th scope="col">操作</th>
  </tr></thead>
  <tbody>{rows.map(c=><tr key={c.id} className={previewId===c.id?'is-previewing':undefined}>
   {selection&&<td className="selection-cell">{selection.cell(c)}</td>}
   {columns.map(key=>key==='name'
    ?<td key={key} className={onPreview?'customer-cell':undefined} onClick={onPreview?previewFromCell(c):undefined}><CustomerCell c={c} onPreview={onPreview}/></td>
    :<td key={key}>{CELLS[key](c,ctx)}</td>)}
   <td><button className="text-button" onClick={()=>onFollow(c)}><MessageSquare size={14}/>跟进</button></td>
  </tr>)}</tbody>
 </table>{!rows.length&&<div className="empty">暂无数据，试试调整筛选或新建客户。</div>}</div>;
}

/**
 * The same customers as cards, for phones (app/mobile-lists.css): who it is, the grade, the stage (changed in place as
 * in the table), who works it, when it came in and when it is due. The chat icon opens the conversation in 消息; a lead
 * waiting in the pool gets 分配 instead. Tapping the card opens the side preview. 「定制列」 does not apply here.
 */
export function CustomerCards({rows,tz,hours=DEFAULT_WORK_HOURS,onFollow,onChanged,onPreview,onAssign,previewId,selection}:{
 rows:Customer[];tz:string;hours?:WorkHours;onFollow:(c:Customer)=>void;onChanged?:(message:string)=>void;
 onPreview?:(c:Customer,fromKeyboard?:boolean)=>void;onAssign?:(c:Customer)=>void;previewId?:string;selection?:{header:ReactNode;cell:(c:Customer)=>ReactNode};
}){
 const previewFromCard=(c:Customer)=>(e:React.MouseEvent)=>{if(!(e.target as HTMLElement).closest('a,button,input,select,label'))onPreview?.(c);};
 if(!rows.length)return <div className="empty">暂无数据，试试调整筛选或新建客户。</div>;
 return <>
  {selection&&<label className="customer-cards-all">{selection.header}全选本页</label>}
  <ul className="customer-cards">{rows.map(c=>{
   const entry=entryOf({inquiryAt:c.inquiryAt?new Date(c.inquiryAt):null,createdAt:new Date(c.createdAt)},tz);
   const off=entry.exact&&!inWorkHours(entry.at,tz,hours);
   return <li key={c.id} className={`customer-card-row${previewId===c.id?' is-previewing':''}`} onClick={onPreview?previewFromCard(c):undefined}>
    {selection&&<label className="customer-card-select">{selection.cell(c)}</label>}
    <span className="avatar" aria-hidden>{c.name.slice(0,1)}</span>
    <div className="customer-card-main">
     <strong><Link className="customer-name" href={`/customers/${c.id}`}>{c.name}</Link><GradeChip grade={c.leadGrade} reason={c.leadGradeReason} source={c.leadGradeSource}/></strong>
     <small>{[c.companyName||'未填写公司',c.country].filter(Boolean).join(' · ')}</small>
     <div className="customer-card-facts"><StageCell c={c} onChanged={onChanged}/><span>{c.pendingAssignment?`待分配 · 已等 ${waited(c.createdAt)}`:c.owner?.name}</span></div>
     <small className="customer-card-times">进线 {entryLabel(entry.at,tz,entry.exact)}{off&&<em className="entry-off">工作时间外</em>} · 下次跟进 <Due date={c.nextFollowUpAt} tz={tz}/></small>
    </div>
    <div className="customer-card-actions">
     {c.pendingAssignment&&onAssign
      ?<button type="button" className="primary" onClick={()=>onAssign(c)}>分配</button>
      :<Link className="customer-card-chat" href={`/messages?customer=${encodeURIComponent(c.id)}`} aria-label={`打开与 ${c.name} 的聊天`}><MessageCircle size={18} aria-hidden/></Link>}
     <button type="button" className="text-button" onClick={()=>onFollow(c)}><MessageSquare size={14} aria-hidden/>跟进</button>
    </div>
   </li>;})}
  </ul>
 </>;
}
