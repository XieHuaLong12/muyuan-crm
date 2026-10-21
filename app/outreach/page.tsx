import { BOSShell } from '@/components/bos/BOSShell';
import { OutreachDashboard } from '@/components/outreach/OutreachDashboard';
import { jsonForClient, workspacePage } from '@/services/workspace-page';
import { dashboardQuery, outreachDashboard } from '@/services/outreach-analytics-service';
export const dynamic='force-dynamic';

/** 话术效果看板, for operations and salespeople alike. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const {user,boot}=await workspacePage();
  const query=dashboardQuery.safeParse(await searchParams);
  const data=await outreachDashboard(user,query.success?query.data:{});
  return <BOSShell boot={boot}><OutreachDashboard data={jsonForClient(data)}/></BOSShell>;
}
