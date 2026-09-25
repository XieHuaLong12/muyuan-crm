import { BOSShell } from '@/components/bos/BOSShell';
import { SalesDashboard } from '@/components/workspace/SalesDashboard';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { salesHome } from '@/services/sales-workspace-service';
import type { SalesHome } from '@/lib/workspace-types';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await workspacePage();const home=await salesHome(user);return <BOSShell boot={boot}><div className="v3-shell bos-embed"><SalesDashboard initial={jsonForClient<SalesHome>(home)} name={user.name} timezone={boot.settings.timezone}/></div></BOSShell>;}
