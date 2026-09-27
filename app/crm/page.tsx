import { BOSShell } from '@/components/bos/BOSShell';
import { CrmKanban } from '@/components/bos-v2/CrmKanban';
import { workspacePage } from '@/services/workspace-page';
import { crmBoard } from '@/services/bos-crm-service';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await workspacePage();return <BOSShell boot={boot}><CrmKanban data={await crmBoard(user)}/></BOSShell>;}
