import { BOSShell } from '@/components/bos/BOSShell';
import { Workspace } from '@/components/workspace';
import { adminWorkspacePage } from '@/services/workspace-page';
export const dynamic='force-dynamic';
export default async function Page(){const {boot}=await adminWorkspacePage();return <BOSShell boot={boot}><Workspace initialBoot={boot} pageOverride="integrations"/></BOSShell>;}
