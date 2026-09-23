'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CircleGauge,Layers3,PanelLeft,Users,MessageCircle,CheckSquare,ArrowLeft,Package,PanelLeftClose,PanelLeftOpen,Percent } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const core:readonly (readonly [string,string,LucideIcon])[]=[['/command-center','老板驾驶舱',CircleGauge],['/growth','运营中心',Layers3],['/sales','销售工作台',PanelLeft],['/products','产品库',Package]];
// 成本与毛利是敏感数据，仅管理员可见
const adminOnly:readonly (readonly [string,string,LucideIcon])[]=[['/products/margin','成本毛利',Percent]];
const tools:readonly (readonly [string,string,LucideIcon])[]=[['/customers','客户 CRM',Users],['/whatsapp','WhatsApp',MessageCircle],['/tasks','任务中心',CheckSquare]];

/** 折叠状态保存在浏览器里，刷新与切页后保持。 */
const STORAGE_KEY='bos-sidebar-collapsed';

export function Sidebar({name,role}:{name:string;role:string}){
 const path=usePathname();
 const [collapsed,setCollapsed]=useState(false);

 // 在 effect 里读取，避免服务端渲染与客户端不一致
 useEffect(()=>{try{setCollapsed(window.localStorage.getItem(STORAGE_KEY)==='1');}catch{/* 隐私模式不可用，忽略 */}},[]);

 function toggle(){
  setCollapsed(prev=>{
   const next=!prev;
   try{window.localStorage.setItem(STORAGE_KEY,next?'1':'0');}catch{/* 忽略 */}
   return next;
  });
 }

 function group(label:string,items:readonly (readonly [string,string,LucideIcon])[],aria:string){
  return <div className="bos-nav-group"><span>{label}</span><nav aria-label={aria}>{items.map(([url,text,Icon])=><Link aria-current={path===url?'page':undefined} href={url} key={url} title={collapsed?text:undefined}><Icon size={18} strokeWidth={1.6}/><span>{text}</span></Link>)}</nav></div>;
 }

 return <aside className={`bos-sidebar${collapsed?' is-collapsed':''}`}>
  <div className="bos-sidebar-head">
   <Link href="/command-center" className="bos-brand"><span className="bos-brand-mark">L</span><span>LVANJU<small>BUSINESS OS</small></span></Link>
   <button type="button" className="bos-sidebar-toggle" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed?'展开侧边栏':'折叠侧边栏'} title={collapsed?'展开侧边栏':'折叠侧边栏'}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>}</button>
  </div>
  {group('工作空间',core,'BOS 核心模块')}
  {role==='ADMIN'&&group('管理',adminOnly,'管理员功能')}
  {group('日常工具',tools,'CRM 工具')}
  <div className="bos-sidebar-bottom">
   <Link href="/" className="bos-legacy" title={collapsed?'原 CRM 首页':undefined}><ArrowLeft size={15}/><span>原 CRM 首页</span></Link>
   <div className="bos-account"><span className="bos-avatar">{name.slice(0,1)}</span><div><strong>{name}</strong><small>{role==='ADMIN'?'管理员':'销售顾问'}</small></div><span className="bos-presence" aria-label="已登录"/></div>
  </div>
 </aside>;
}
