import { BOSShell } from '@/components/bos/BOSShell';
import { Workspace } from '@/components/workspace';
import { workspacePage } from '@/services/workspace-page';
export const dynamic='force-dynamic';
export default async function Page(){const {boot}=await workspacePage();return <BOSShell boot={boot}><Workspace initialBoot={boot} pageOverride="settings" embedded/></BOSShell>;}
