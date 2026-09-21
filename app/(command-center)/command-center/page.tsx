import { BOSShell } from '@/components/bos/BOSShell';
import { CommandCenter } from '@/components/bos/CommandCenter';
import { workspacePage } from '@/services/workspace-page';
import { commandCenter } from '@/services/bos-command-service';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await workspacePage();return <BOSShell boot={boot}><CommandCenter data={await commandCenter(user)} name={user.name}/></BOSShell>;}
