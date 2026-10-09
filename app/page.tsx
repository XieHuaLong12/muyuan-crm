import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { workspaceHome } from '@/lib/role-workspace';
export const dynamic='force-dynamic';
export default async function Home(){const user=await currentUser();redirect(user?workspaceHome(user.role):'/login');}
