import { BOSShell } from '@/components/bos/BOSShell';
import { WorkbenchCalendar } from '@/components/workbench/WorkbenchCalendar';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { workbench, workbenchQuery } from '@/services/workbench-service';
export const dynamic='force-dynamic';

/** 工作台 home for administrators: the calendar's today view, with week and month views. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const {user,boot}=await adminWorkspacePage();
  const query=workbenchQuery.safeParse(await searchParams);
  const data=await workbench(user,query.success?query.data:{});
  return <BOSShell boot={boot}><WorkbenchCalendar initial={jsonForClient(data)}/></BOSShell>;
}
