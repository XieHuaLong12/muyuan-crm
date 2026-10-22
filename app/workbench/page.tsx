import { BOSShell } from '@/components/bos/BOSShell';
import { WorkbenchToday } from '@/components/workbench/WorkbenchToday';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { workbench } from '@/services/workbench-service';
export const dynamic='force-dynamic';

/** 工作台 home for administrators: today (focus, three things, the evening review); 复盘 and 记录 are its sub-pages. */
export default async function Page(){
  const {user,boot}=await adminWorkspacePage();
  return <BOSShell boot={boot}><WorkbenchToday initial={jsonForClient(await workbench(user))}/></BOSShell>;
}
