import { BOSShell } from '@/components/bos/BOSShell';
import { FinanceCenter } from '@/components/bos-v2/FinanceCenter';
import { adminWorkspacePage } from '@/services/workspace-page';
import { financeOverview } from '@/services/bos-v2-service';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await adminWorkspacePage();return <BOSShell boot={boot}><FinanceCenter data={await financeOverview(user)}/></BOSShell>;}
