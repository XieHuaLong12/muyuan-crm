import { Workspace } from '@/components/workspace';
import { workspacePage } from '@/services/workspace-page';
export const dynamic='force-dynamic';
export default async function Page(){const {boot}=await workspacePage();return <Workspace initialBoot={boot} pageOverride="customers"/>;}
