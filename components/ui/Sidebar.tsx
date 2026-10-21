'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { usePathname,useRouter } from 'next/navigation';
import { LayoutDashboard,TrendingUp,Users,Package,CheckSquare,Settings,PanelLeftClose,PanelLeftOpen,LogOut,CalendarCheck,CalendarDays,UserRoundCog,Menu,X,KeyRound,Megaphone,Armchair,MessageCircle,MessageSquareQuote } from 'lucide-react';
import { PasswordDialog } from '@/components/password-dialog';
import { api } from '@/lib/client';
import { workspaceHome,workspaceNavigation,activeWorkspaceLink,type NavIcon,type NavSection } from '@/lib/role-workspace';
import { forgetPushSubscription } from '@/components/push-notifications';

const icons:Record<NavIcon,typeof Users>={workbench:CalendarDays,scripts:MessageSquareQuote,dashboard:LayoutDashboard,customers:Users,messages:MessageCircle,tasks:CheckSquare,orders:Package,growth:Megaphone,team:UserRoundCog,settings:Settings,today:CalendarCheck,products:Armchair,performance:TrendingUp};
/** Live counts shown next to a sidebar entry (today's work for sales, the assignment pool for admins). */
export type NavBadges=Partial<Record<NonNullable<NavSection['badge']>,{count:number;urgent:boolean}>>;
const STORAGE_KEY='bos-sidebar-collapsed';

export function Sidebar({name,role,badges={}}:{name:string;role:string;badges?:NavBadges}){
 const path=usePathname();const router=useRouter();const [collapsed,setCollapsed]=useState(false);const [mobileOpen,setMobileOpen]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{try{setCollapsed(window.localStorage.getItem(STORAGE_KEY)==='1');}catch{/* Storage can be unavailable. */}},[]);
 function toggle(){setCollapsed(value=>{const next=!value;try{window.localStorage.setItem(STORAGE_KEY,next?'1':'0');}catch{}return next;});}
 const [passwordOpen,setPasswordOpen]=useState(false);
 async function logout(){try{await forgetPushSubscription().catch(()=>{});await api('auth/logout','POST');router.push('/login');}catch(e){setError((e as Error).message);}}
 const active=activeWorkspaceLink(path,role),isAdmin=role==='ADMIN';
 return <aside className={`bos-sidebar bos-v2-sidebar${collapsed?' is-collapsed':''}${mobileOpen?' is-mobile-open':''}`}>
  <div className="bos-sidebar-head"><Link href={workspaceHome(role)} className="bos-brand"><span className="bos-brand-mark">L</span><span>LVANJU<small>{isAdmin?'管理工作空间':'销售工作空间'}</small></span></Link><button type="button" className="bos-sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed?'展开侧边栏':'折叠侧边栏'}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>}</button><button type="button" className="bos-sidebar-mobile-toggle" aria-label={mobileOpen?'关闭导航':'打开导航'} aria-expanded={mobileOpen} aria-controls="bos-primary-nav" onClick={()=>setMobileOpen(value=>!value)}>{mobileOpen?<X size={20}/>:<Menu size={20}/>}</button></div>
  <div className="bos-nav-group"><span>{isAdmin?'团队经营与管理':'我的销售工作'}</span><nav id="bos-primary-nav" aria-label={isAdmin?'管理员导航':'销售导航'}>{workspaceNavigation(role).map(({href,label,icon,badge})=>{const Icon=icons[icon];const live=badge?badges[badge]:undefined;return <Link href={href} key={href} onClick={()=>setMobileOpen(false)} aria-current={active===href?'page':undefined} title={collapsed?label:undefined}><Icon size={18} strokeWidth={1.7}/><span>{label}</span>{!!live?.count&&<b className={`bos-nav-badge${live.urgent?' is-urgent':''}`} aria-label={`${live.count} 项`}>{live.count}</b>}</Link>;})}</nav></div>
  <div className="bos-sidebar-bottom"><div className="bos-account"><span className="bos-avatar">{name.slice(0,1)}</span><div><strong>{name}</strong><small>{role==='ADMIN'?'管理员':'销售顾问'}</small></div><button type="button" className="bos-icon-button" onClick={()=>setPasswordOpen(true)} aria-label="修改密码" title="修改密码"><KeyRound size={16}/></button><button type="button" className="bos-icon-button" onClick={logout} aria-label="退出登录"><LogOut size={16}/></button></div>{error&&<p className="bos-cost-error" role="alert">{error}</p>}</div>
 {passwordOpen&&<PasswordDialog onClose={()=>setPasswordOpen(false)}/>}</aside>;
}
