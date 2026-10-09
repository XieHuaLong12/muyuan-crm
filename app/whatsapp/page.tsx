import { redirect } from 'next/navigation';
import { adminWorkspacePage } from '@/services/workspace-page';
export const dynamic='force-dynamic';
export default async function Page(){await adminWorkspacePage();redirect('/communication');}
