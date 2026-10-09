import { BOSShell } from '@/components/bos/BOSShell';
import { SalesTeam } from '@/components/bos/SalesTeam';
import { workspacePage } from '@/services/workspace-page';
import { salesPerformance } from '@/services/sales-team-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const {user,boot}=await workspacePage();
  return <BOSShell boot={boot}><SalesTeam data={await salesPerformance(user,await searchParams)}/></BOSShell>;
}
