'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { usePathname,useRouter } from 'next/navigation';
import { LayoutDashboard,TrendingUp,Users,MessagesSquare,Package,Wallet,Sparkles,Settings,PanelLeftClose,PanelLeftOpen,LogOut } from 'lucide-react';
import { api } from '@/lib/client';

const primary=[
 ['/command-center','经营驾驶舱',LayoutDashboard],
 ['/growth','增长中心',TrendingUp],
 ['/analytics/ads','广告分析',TrendingUp],
 ['/crm','客户中心',Users],
 ['/communication','沟通中心',MessagesSquare],
 ['/orders','订单中心',Package],
 ['/finance','财务中心',Wallet],
 ['/tasks','AI 行动中心',Sparkles],
 ['/settings','系统设置',Settings],
] as const;
const STORAGE_KEY='bos-sidebar-collapsed';

export function Sidebar({name,role}:{name:string;role:string}){
 const path=usePathname();const router=useRouter();const [collapsed,setCollapsed]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{try{setCollapsed(window.localStorage.getItem(STORAGE_KEY)==='1');}catch{/* Storage can be unavailable. */}},[]);
 function toggle(){setCollapsed(value=>{const next=!value;try{window.localStorage.setItem(STORAGE_KEY,next?'1':'0');}catch{}return next;});}
 async function logout(){try{await api('auth/logout','POST');router.push('/login');}catch(e){setError((e as Error).message);}}
 const active=path.startsWith('/analytics/')?'/analytics/ads':path.startsWith('/sales')||path.startsWith('/customers')?'/crm':path.startsWith('/whatsapp')?'/communication':path.startsWith('/products')?'/orders':path;
 return <aside className={`bos-sidebar bos-v2-sidebar${collapsed?' is-collapsed':''}`}>
  <div className="bos-sidebar-head"><Link href="/command-center" className="bos-brand"><span className="bos-brand-mark">L</span><span>LVANJU<small>BUSINESS OS</small></span></Link><button type="button" className="bos-sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed?'展开侧边栏':'折叠侧边栏'}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>}</button></div>
  <div className="bos-nav-group"><span>工作空间</span><nav aria-label="主导航">{primary.filter(([url])=>url!=='/finance'||role==='ADMIN').map(([url,label,Icon])=><Link href={url} key={url} aria-current={active===url||active.startsWith(`${url}/`)?'page':undefined} title={collapsed?label:undefined}><Icon size={18} strokeWidth={1.7}/><span>{label}</span></Link>)}</nav></div>
  <div className="bos-sidebar-bottom"><div className="bos-account"><span className="bos-avatar">{name.slice(0,1)}</span><div><strong>{name}</strong><small>{role==='ADMIN'?'管理员':'销售顾问'}</small></div><button type="button" className="bos-icon-button" onClick={logout} aria-label="退出登录"><LogOut size={16}/></button></div>{error&&<p className="bos-cost-error" role="alert">{error}</p>}</div>
 </aside>;
}
