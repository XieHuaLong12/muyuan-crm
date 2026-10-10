import { redirect } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { SalesTeam } from '@/components/bos/SalesTeam';
import { workspacePage } from '@/services/workspace-page';
import { salesPerformance } from '@/services/sales-team-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const {user,boot}=await workspacePage();
  // Administrators read team performance on /team; this page is a salesperson's own view.
  if(user.role==='ADMIN')redirect('/team');
  return <BOSShell boot={boot}><SalesTeam data={await salesPerformance(user,await searchParams)}/></BOSShell>;
}
