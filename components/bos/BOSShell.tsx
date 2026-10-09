'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { Bell,ArrowUpRight } from 'lucide-react';
import { SystemStatus } from '@/components/ui/motion';
import type { Bootstrap } from '@/lib/types';
import { Sidebar } from '@/components/ui/Sidebar';
import { Search } from '@/components/ui/bos';
export function BOSShell({boot,children}:{boot:Bootstrap;children:React.ReactNode}){
 const [notices,setNotices]=useState(0),[newLeads,setNewLeads]=useState(0),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function refresh(){try{if(!document.hidden){const [response,focus]=await Promise.all([fetch('/api/reminders',{cache:'no-store',signal:controller.signal}),fetch('/api/sales-team/focus',{cache:'no-store',signal:controller.signal})]);const [body,leadBody]=await Promise.all([response.json(),focus.json()]);if(!body.success||!leadBody.success)throw new Error('提醒暂时不可用');if(!controller.signal.aborted){setNotices(body.data.length);setNewLeads(leadBody.data.pending);setError('');}const sync=await fetch('/api/workflows/sync',{method:'POST',signal:controller.signal});if(!sync.ok)throw new Error('自动任务同步暂时不可用');}}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}if(!controller.signal.aborted)timer=setTimeout(refresh,60000);}
  void refresh();return()=>{controller.abort();clearTimeout(timer);};
 },[]);
 return <div className="bos bos-v2"><a className="bos-skip" href="#bos-main">跳到主要内容</a><Sidebar name={boot.user.name} role={boot.user.role}/><div className="bos-main-frame"><div className="bos-topbar"><span className="bos-topbar-label">LVANJU <span>{boot.user.role==='ADMIN'?'管理员 · 团队经营':'销售 · 我的工作空间'}</span></span><SystemStatus/><form action="/sales"><input type="hidden" name="queue" value="recent"/><Search name="q" label={boot.user.role==='ADMIN'?'搜索团队客户':'搜索我的客户'} placeholder="搜索客户或公司"/></form>{newLeads>0&&<Link href="/sales?queue=new" className="bos-lead-notice">待首联 {newLeads}</Link>}<Link href="/tasks" className="bos-notification" aria-label={`任务提醒 ${notices} 条`}><Bell size={19}/>{notices>0&&<span>{notices}</span>}</Link><Link href={boot.user.role==='ADMIN'?'/team':'/tasks?view=TODAY'} className="bos-topbar-link">{boot.user.role==='ADMIN'?'销售团队':'今日任务'} <ArrowUpRight size={14}/></Link></div>{error&&<p className="bos-sync-error" role="status">{error}，将在后台重试。<Link href="/tasks">查看已有任务</Link></p>}<main id="bos-main" className="bos-main">{children}</main></div></div>;
}
