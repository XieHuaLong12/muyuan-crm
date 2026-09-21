'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { usePathname,useRouter } from 'next/navigation';
import { Armchair,Sun,Users,MessageCircle,CheckSquare,BarChart3,Target,Settings,Search,Bell,Menu,LogOut,X,ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/client';
import type { Bootstrap } from '@/lib/types';
import type { Notice } from '@/lib/workspace-types';
const links=[['/','Today',Sun],['/customers','客户 CRM',Users],['/whatsapp','WhatsApp',MessageCircle],['/tasks','任务中心',CheckSquare],['/funnel','销售漏斗',BarChart3],['/targets','目标管理',Target],['/analytics','数据分析',BarChart3],['/settings','设置',Settings]] as const;
export function WorkspaceShell({boot,children}:{boot:Bootstrap;children:React.ReactNode}){
 const path=usePathname(),router=useRouter();const [mobile,setMobile]=useState(false),[open,setOpen]=useState(false),[notices,setNotices]=useState<Notice[]>([]),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;let timer:ReturnType<typeof setTimeout>;
  const controller=new AbortController();
  async function sync(){
   try{const response=await fetch('/api/workflows/sync',{method:'POST',signal:controller.signal});
    if(!response.ok)throw new Error('sync failed');
   }catch{if(active)setError('自动任务同步暂时失败，将自动重试');}
   if(active)timer=setTimeout(sync,60000);
  }
  void sync();return()=>{active=false;controller.abort();clearTimeout(timer);};
 },[]);
 useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();async function poll(){try{const response=await fetch('/api/reminders',{signal:controller.signal,cache:'no-store'});const body=await response.json();if(active&&body.success){setNotices(body.data);setError('');}}catch{if(active)setError('提醒暂时无法同步');}if(active)timer=setTimeout(poll,30000);}void poll();return()=>{active=false;controller.abort();clearTimeout(timer);};},[]);
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();document.getElementById('workspace-search')?.focus();}if(e.key==='Escape'){setOpen(false);setMobile(false);}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
 async function dismiss(id:string){const old=notices;setNotices(items=>items.filter(n=>n.id!==id));try{await api(`reminders/${id}`,'PATCH');}catch(e){setNotices(old);setError((e as Error).message);}}
 return <div className="v3-shell"><aside className={`v3-sidebar ${mobile?'is-open':''}`}><Link href="/" className="v3-brand"><span><Armchair size={23}/></span><div>木远 CRM<small>LVANJU · SALES WORKSPACE</small></div></Link><span className="v3-nav-label">工作空间</span><nav>{links.map(([url,label,Icon])=><Link key={url} href={url} onClick={()=>setMobile(false)} className={(url==='/'?path==='/':path.startsWith(url))?'active':''}><Icon size={18} strokeWidth={1.6}/><span className="v3-nav-text">{label}</span>{url==='/tasks'&&notices.length>0&&<span className="v3-nav-count">{notices.length}</span>}</Link>)}</nav><div className="v3-sidebar-footer"><div className="v3-company"><span/>{boot.settings.companyName}</div><div className="v3-user"><span className="v3-avatar">{boot.user.name.slice(0,1)}</span><div><strong>{boot.user.name}</strong><small>{boot.user.role==='ADMIN'?'管理员':'销售顾问'}</small></div><button className="v3-icon" aria-label="退出登录" onClick={async()=>{try{await api('auth/logout','POST');router.push('/login');}catch(e){setError((e as Error).message);}}}><LogOut size={17}/></button></div></div></aside>{mobile&&<button className="v3-scrim" aria-label="关闭导航" onClick={()=>setMobile(false)}/>}
 <div className="v3-main"><header className="v3-topbar"><button className="v3-icon v3-mobile-menu" aria-label="打开导航" onClick={()=>setMobile(true)}><Menu size={20}/></button><div className="v3-breadcrumb">工作空间 <span>/</span> <strong>{links.find(([url])=>url==='/'?path==='/':path.startsWith(url))?.[1]||'客户详情'}</strong></div><form className="v3-global-search" action="/customers"><Search size={16}/><input id="workspace-search" name="q" aria-label="全局搜索客户" placeholder="搜索客户、公司或联系方式"/><kbd>⌘ K</kbd></form><span className="v3-today-date">{new Intl.DateTimeFormat('zh-CN',{timeZone:boot.settings.timezone,month:'long',day:'numeric',weekday:'short'}).format(new Date())}</span><button aria-label={`通知中心，${notices.length} 条提醒`} aria-expanded={open} className="v3-icon v3-bell" onClick={()=>setOpen(!open)}><Bell size={20}/>{notices.length>0&&<i/>}</button></header>
 {open&&<section className="v3-notifications" aria-label="通知中心"><div className="v3-section-heading"><div><h2>提醒</h2><p>提前安排，让每一步都有着落</p></div><button className="v3-icon" aria-label="关闭提醒" onClick={()=>setOpen(false)}><X size={18}/></button></div>{notices.map(n=><div key={n.id} className="v3-notice"><Link href={`/tasks?task=${n.task.id}`} onClick={()=>setOpen(false)}><strong>{n.task.title}</strong><small className={n.kind==='OVERDUE'?'v3-danger':''}>{n.kind==='OVERDUE'?'已逾期，请优先处理':'即将到期'} · {n.task.customer?.name||'个人任务'}</small></Link><button className="v3-icon" aria-label={`忽略提醒 ${n.task.title}`} onClick={()=>dismiss(n.id)}><X size={15}/></button></div>)}{!notices.length&&<div className="v3-empty"><CheckSquare size={28}/><p>暂时没有需要处理的提醒</p></div>}<Link href="/tasks" className="v3-text-link" onClick={()=>setOpen(false)}>打开任务中心 <ArrowUpRight size={15}/></Link>{error&&<p role="alert" className="error">{error}</p>}</section>}
 <main className="v3-content">{children}</main></div></div>;
}
