import { BOSShell } from '@/components/bos/BOSShell';
import { IdeaWall } from '@/components/ideas/IdeaWall';
import { jsonForClient, workspacePage } from '@/services/workspace-page';
import { wall } from '@/services/idea-wall-service';

export const dynamic = 'force-dynamic';

/** 想法墙: my own wall of ideas, lines I like and useful things. Everyone has one; nobody else sees it. */
export default async function Page() {
  const { user, boot } = await workspacePage();
  return <BOSShell boot={boot}><IdeaWall initial={jsonForClient(await wall(user))} admin={user.role === 'ADMIN'} /></BOSShell>;
}
