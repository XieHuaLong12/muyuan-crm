import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { Workspace } from '@/components/workspace';
import { AgentTools } from '@/components/agent-tools';
export const dynamic='force-dynamic';
export default async function Page(){if(!await currentUser())redirect('/login');return <><AgentTools/><Workspace/></>;}
