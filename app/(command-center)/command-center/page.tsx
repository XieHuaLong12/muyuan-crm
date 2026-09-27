import { BOSShell } from '@/components/bos/BOSShell';
import { Dashboard } from '@/components/bos-v2/Dashboard';
import { workspacePage } from '@/services/workspace-page';
import { businessCockpit } from '@/services/business-cockpit-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{range?:string;startDate?:string;endDate?:string;trend?:string}>}){const {user,boot}=await workspacePage();return <BOSShell boot={boot}><Dashboard data={await businessCockpit(user,await searchParams)} name={user.name}/></BOSShell>;}
