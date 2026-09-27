import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { SalesOS } from '@/components/bos/SalesOS';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { salesQueue,salesQuery } from '@/services/bos-sales-service';
import { customerDetail } from '@/services/sales-workspace-service';
import type { Customer } from '@/lib/types';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();const query=await searchParams;const channel=['whatsapp','messenger','email'].includes(query.channel||'')?query.channel:'whatsapp';
 let content:React.ReactNode;
 if(channel==='whatsapp'){
  const parsed=salesQuery.safeParse({...query,queue:query.queue||'recent'});const data=await salesQueue(user,parsed.success?parsed.data:{queue:'recent'});
  const id=query.customer||data.customers[0]?.id;const customer=id?await customerDetail(id,user):null;
  if(query.customer&&!customer)notFound();
  content=<div className="bos-v2-communication-workspace"><SalesOS key={`${data.query.queue}-${data.query.q}-${data.query.page}-${id||''}`} data={data} initialCustomer={jsonForClient<Customer|null>(customer)} boot={boot}/></div>;
 }else content=<section className="bos-v2-surface bos-v2-channel-empty"><strong>{channel==='messenger'?'Facebook Messenger':'Email'}</strong><h2>渠道接入准备中</h2><p>此渠道尚未连接。现有 WhatsApp 聊天记录、AI 回复与客户跟进仍可在上方切换查看。</p><Link href="/communication" className="bos-v2-primary">查看 WhatsApp</Link></section>;
 return <BOSShell boot={boot}><div className="bos-v2-page"><header className="bos-v2-hero"><div><span className="bos-v2-kicker">COMMUNICATION CENTER / 沟通中心</span><h1>所有重要对话，回到客户身边。</h1><p>聊天记录、AI 回复和下一次跟进，共享同一个客户上下文。</p></div><Link href="/tasks" className="bos-v2-secondary">查看跟进提醒</Link></header><nav className="bos-v2-channel-tabs" aria-label="沟通渠道">{[['whatsapp','WhatsApp'],['messenger','Messenger'],['email','Email']].map(([key,label])=><Link key={key} href={`/communication?channel=${key}`} aria-current={channel===key?'page':undefined}>{label}{key!=='whatsapp'&&<small>待接入</small>}</Link>)}</nav>{content}</div></BOSShell>;
}
