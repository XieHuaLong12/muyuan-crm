import Link from 'next/link';
import { BOSShell } from '@/components/bos/BOSShell';
import { Header } from '@/components/ui/bos';
import { Funnel,Analytics } from '@/components/dashboard';
import { adminWorkspacePage,jsonForClient } from '@/services/workspace-page';
import { dashboard } from '@/services/dashboard-service';
import type { Dashboard } from '@/lib/types';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await adminWorkspacePage();const query=await searchParams;
 const period=(['WEEK','MONTH','YEAR'].includes(query.period||'')?query.period:'MONTH') as 'WEEK'|'MONTH'|'YEAR';
 const currency=['CNY','USD','EUR'].includes(query.currency||'')?query.currency!:'CNY';
 const today=new Date().toISOString().slice(0,10);const date=query.date&&/^\d{4}-\d{2}-\d{2}$/.test(query.date)?query.date:today;
 const analytics=jsonForClient<Dashboard>(await dashboard(user,period,date,currency));
 return <BOSShell boot={boot}><div className="bos-v2-page"><Header eyebrow="DASHBOARD / 历史分析" title="销售分析" description="保留原有销售趋势、来源、国家分布与历史阶段流转。" actions={<Link href="/command-center" className="bos-button">返回驾驶舱</Link>}/><nav className="bos-segmented" aria-label="统计周期与币种">{([['WEEK','本周'],['MONTH','本月'],['YEAR','本年']] as const).map(([key,label])=><Link key={key} href={`/command-center/legacy?period=${key}&currency=${currency}`} aria-current={period===key?'page':undefined}>{label}</Link>)}{([['CNY','¥'],['USD','$'],['EUR','€']] as const).map(([key,label])=><Link key={key} href={`/command-center/legacy?period=${period}&currency=${key}`} aria-current={currency===key?'page':undefined}>{label}</Link>)}</nav><div className="v3-legacy bos-analytics" style={{marginTop:20}}><Funnel data={analytics} compact/><Analytics data={analytics}/></div></div></BOSShell>;
}
