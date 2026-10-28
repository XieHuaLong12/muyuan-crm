import { BOSShell } from '@/components/bos/BOSShell';
import { RadarBoard } from '@/components/radar/RadarBoard';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { listProspects } from '@/services/radar-prospect-service';
export const dynamic='force-dynamic';

/** 雷达客户: the companies the customer radar found, scored, as cards or a list (docs/CUSTOMER_RADAR_COLD_EMAIL.md). */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {user,boot}=await adminWorkspacePage();
  const query=Object.fromEntries(Object.entries(await searchParams).map(([key,value])=>[key,Array.isArray(value)?value[0]:value]));
  const data=await listProspects(user,query);
  return <BOSShell boot={boot}><RadarBoard data={jsonForClient(data)}/></BOSShell>;
}
