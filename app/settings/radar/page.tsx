import { BOSShell } from '@/components/bos/BOSShell';
import { RadarSettings } from '@/components/radar/RadarSettings';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { radarSettings } from '@/services/radar-config-service';
export const dynamic='force-dynamic';

/** 设置 · 客户雷达: keyword × city table, countries and sending hours, sending rules. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {user,boot}=await adminWorkspacePage();
  const query=await searchParams;
  const one=(value:string|string[]|undefined)=>(Array.isArray(value)?value[0]:value)?.slice(0,200);
  return <BOSShell boot={boot}><RadarSettings data={jsonForClient(await radarSettings(user))} notice={{connected:one(query.mailboxConnected),error:one(query.mailboxError)}}/></BOSShell>;
}
