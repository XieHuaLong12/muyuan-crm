import { BOSShell } from '@/components/bos/BOSShell';
import { SalesTeam } from '@/components/bos/SalesTeam';
import { adminWorkspacePage } from '@/services/workspace-page';
import { salesPerformance } from '@/services/sales-team-service';
import { salesAccounts } from '@/services/sales-account-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const {user,boot}=await adminWorkspacePage();
  const query=await searchParams;
  const [data,accounts]=await Promise.all([salesPerformance(user,query),salesAccounts(user)]);
  return <BOSShell boot={boot}><SalesTeam data={data} accounts={accounts} admin initialTab={query.tab==='accounts'?'accounts':'performance'}/></BOSShell>;
}
