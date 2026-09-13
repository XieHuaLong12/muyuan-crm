import { MetaSubmission,MetaValues,metaFields,MetaField } from '@/lib/meta-import';
export function LeadHistory({submissions,tz}:{submissions:MetaSubmission[];tz:string}){
 if(!submissions.length)return null;
 return <section className="card"><h3>留资历史 · 共 {Math.max(...submissions.map(s=>s.ordinal))} 次</h3>{submissions.map(s=>{
  const values=JSON.parse(s.values) as MetaValues,raw=JSON.parse(s.raw) as Record<string,string>,pending=JSON.parse(s.translationPending) as string[];
  return <article className="lead-history" key={s.id}><strong>第 {s.ordinal} 次留资 · {new Date(s.occurredAt).toLocaleDateString('zh-CN',{timeZone:tz})}</strong><p className="muted">{values.source||'来源未填写'} · {values.adName||'广告未填写'}</p>{pending.length>0&&<p className="notice">翻译待处理：{pending.join('、')}（保留原文）</p>}<dl className="import-original">{Object.entries(values).filter(([key,value])=>value&&!['inquiryAt','source','adName'].includes(key)).map(([key,value])=><div key={key}><dt>{metaFields[key as MetaField]}</dt><dd>{value}</dd></div>)}</dl><details><summary>原始 CSV 回答 · {s.filename}</summary><dl className="import-original">{Object.entries(raw).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value||'—'}</dd></div>)}</dl></details></article>;
 })}</section>;
}
