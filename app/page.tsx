import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { SalesDashboard } from '@/components/workspace/SalesDashboard';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { salesHome } from '@/services/sales-workspace-service';
import type { SalesHome } from '@/lib/workspace-types';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await workspacePage();const home=await salesHome(user);return <WorkspaceShell boot={boot}><SalesDashboard initial={jsonForClient<SalesHome>(home)} name={user.name} timezone={boot.settings.timezone}/></WorkspaceShell>;}
