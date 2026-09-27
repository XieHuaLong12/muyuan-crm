import { BOSShell } from '@/components/bos/BOSShell';
import { Dashboard } from '@/components/bos-v2/Dashboard';
import { workspacePage } from '@/services/workspace-page';
import { bosOverview } from '@/services/bos-v2-service';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await workspacePage();return <BOSShell boot={boot}><Dashboard data={await bosOverview(user)} name={user.name}/></BOSShell>;}
