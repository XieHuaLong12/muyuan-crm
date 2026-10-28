import { BOSShell } from '@/components/bos/BOSShell';
import { RadarStats } from '@/components/radar/RadarStats';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { radarStats } from '@/services/radar-analytics-service';
export const dynamic='force-dynamic';

/** 开发信效果: the weekly numbers, template versions compared, and the weekly check of the AI. */
export default async function Page(){
  const {user,boot}=await adminWorkspacePage();
  return <BOSShell boot={boot}><RadarStats data={jsonForClient(await radarStats(user))}/></BOSShell>;
}
