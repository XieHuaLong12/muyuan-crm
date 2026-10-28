import { BOSShell } from '@/components/bos/BOSShell';
import { RadarSettings } from '@/components/radar/RadarSettings';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { radarSettings } from '@/services/radar-config-service';
export const dynamic='force-dynamic';

/** 设置 · 客户雷达: keyword × city table, countries and sending hours, sending rules. */
export default async function Page(){
  const {user,boot}=await adminWorkspacePage();
  return <BOSShell boot={boot}><RadarSettings data={jsonForClient(await radarSettings(user))}/></BOSShell>;
}
