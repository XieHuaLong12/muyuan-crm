import { BOSShell } from '@/components/bos/BOSShell';
import { Dashboard } from '@/components/bos-v2/Dashboard';
import { adminWorkspacePage } from '@/services/workspace-page';
import { businessCockpit } from '@/services/business-cockpit-service';
import { todayBrief } from '@/services/boss-brief-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{range?:string;startDate?:string;endDate?:string;trend?:string}>}){const {user,boot}=await adminWorkspacePage();const [data,brief]=await Promise.all([businessCockpit(user,await searchParams),user.role==='ADMIN'?todayBrief():null]);return <BOSShell boot={boot}><Dashboard data={data} name={user.name} brief={brief}/></BOSShell>;}
