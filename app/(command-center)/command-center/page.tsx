import { BOSShell } from '@/components/bos/BOSShell';
import { CommandCenter } from '@/components/bos/CommandCenter';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { commandCenter } from '@/services/bos-command-service';
import { dashboard } from '@/services/dashboard-service';
import type { Dashboard } from '@/lib/types';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();
 const query=await searchParams;
 const period=(['WEEK','MONTH','YEAR'].includes(query.period||'')?query.period:'MONTH') as 'WEEK'|'MONTH'|'YEAR';
 const currency=['CNY','USD','EUR'].includes(query.currency||'')?query.currency!:'CNY';
 const today=new Date().toISOString().slice(0,10);
 const date=query.date&&/^\d{4}-\d{2}-\d{2}$/.test(query.date)?query.date:today;
 // 原「数据分析」页的销售趋势 / 来源 / 国家分布，与原「销售漏斗」的历史阶段流转，
 // 现在都在驾驶舱里，不再各自占一个页面。
 const [data,analytics]=await Promise.all([commandCenter(user),dashboard(user,period,date,currency)]);
 return <BOSShell boot={boot}><CommandCenter data={data} name={user.name} analytics={jsonForClient<Dashboard>(analytics)} period={period} currency={currency}/></BOSShell>;
}
