'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { usePathname,useRouter } from 'next/navigation';
import { CircleGauge,Layers3,PanelLeft,Users,CheckSquare,ArrowLeft,Package,PanelLeftClose,PanelLeftOpen,Percent,Sun,Target,Settings as SettingsIcon,LogOut,ClipboardList } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/client';

/**
 * 统一导航（白色 BOS 外壳）
 *
 * 以前有两套外壳：深绿 V3 覆盖 9 个页面、白色 BOS 覆盖 6 个，两边导航互不连通，
 * 看起来像两个系统。现在全部页面都挂在这里，只有一套导航。
 */
const workspace:readonly (readonly [string,string,LucideIcon])[]=[['/sales','销售工作台',PanelLeft],['/orders','订单管理',ClipboardList],['/command-center','老板驾驶舱',CircleGauge],['/growth','运营中心',Layers3],['/products','产品库',Package]];
const tools:readonly (readonly [string,string,LucideIcon])[]=[['/','Today',Sun],['/customers','客户管理',Users],['/tasks','AI 行动中心',CheckSquare]];
// 销售漏斗与数据分析已并入老板驾驶舱的「销售分析」；客户批量管理改为客户页的表格视图
const settingsGroup:readonly (readonly [string,string,LucideIcon])[]=[['/targets','目标管理',Target],['/settings','设置',SettingsIcon]];
// 成本是敏感数据，仅管理员可见
const adminOnly:readonly (readonly [string,string,LucideIcon])[]=[['/products/margin','成本毛利',Percent]];

/** 折叠状态保存在浏览器里，刷新与切页后保持。 */
const STORAGE_KEY='bos-sidebar-collapsed';

export function Sidebar({name,role}:{name:string;role:string}){
 const path=usePathname();
 const router=useRouter();
 const [collapsed,setCollapsed]=useState(false);
 const [error,setError]=useState('');

 // 在 effect 里读取，避免服务端渲染与客户端不一致
 useEffect(()=>{try{setCollapsed(window.localStorage.getItem(STORAGE_KEY)==='1');}catch{/* 隐私模式不可用，忽略 */}},[]);

 function toggle(){
  setCollapsed(prev=>{
   const next=!prev;
   try{window.localStorage.setItem(STORAGE_KEY,next?'1':'0');}catch{/* 忽略 */}
   return next;
  });
 }

 async function logout(){
  try{await api('auth/logout','POST');router.push('/login');}catch(e){setError((e as Error).message);}
 }

 function group(label:string,items:readonly (readonly [string,string,LucideIcon])[],aria:string){
  const all=[...workspace,...tools,...settingsGroup,...(role==='ADMIN'?adminOnly:[])];
  return <div className="bos-nav-group"><span>{label}</span><nav aria-label={aria}>{items.map(([url,text,Icon])=>{
   const exact=url==='/';
   const isView=url.includes('?');
   // 最长前缀优先：/products/margin 命中时 /products 不应同时高亮
   const matches=all.filter(([other])=>exact?path==='/':path===other||path.startsWith(`${other}/`));
   const best=matches.sort((a,b)=>b[0].length-a[0].length)[0]?.[0];
   const current=!isView&&(best===url||(exact&&path==='/'));
   return <Link aria-current={current?'page':undefined} href={url} key={url} title={collapsed?text:undefined}><Icon size={18} strokeWidth={1.6}/><span>{text}</span></Link>;
  })}</nav></div>;
 }

 return <aside className={`bos-sidebar${collapsed?' is-collapsed':''}`}>
  <div className="bos-sidebar-head">
   <Link href="/command-center" className="bos-brand"><span className="bos-brand-mark">L</span><span>LVANJU<small>BUSINESS OS</small></span></Link>
   <button type="button" className="bos-sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed?'展开侧边栏':'折叠侧边栏'} title={collapsed?'展开侧边栏':'折叠侧边栏'}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>}</button>
  </div>
  {group('工作空间',workspace,'BOS 核心模块')}
  {group('日常工具',tools,'CRM 工具')}
  {role==='ADMIN'&&group('管理',adminOnly,'管理员功能')}
  {group('设置与管理',settingsGroup,'设置与管理')}
  <div className="bos-sidebar-bottom">
   <Link href="/" className="bos-legacy" title={collapsed?'返回 Today':undefined}><ArrowLeft size={15}/><span>返回 Today</span></Link>
   <div className="bos-account">
    <span className="bos-avatar">{name.slice(0,1)}</span>
    <div><strong>{name}</strong><small>{role==='ADMIN'?'管理员':'销售顾问'}</small></div>
    <button type="button" className="bos-icon-button" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={16}/></button>
   </div>
   {error&&<p className="bos-cost-error" role="alert">{error}</p>}
  </div>
 </aside>;
}
