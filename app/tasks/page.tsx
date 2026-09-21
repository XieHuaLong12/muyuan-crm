import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { TaskCenter } from '@/components/workspace/TaskCenter';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { listTasks,taskInclude,taskScope } from '@/services/task-service';
import { scope } from '@/lib/auth';
import { db } from '@/lib/db';
import type { TaskPage,TaskItem } from '@/lib/workspace-types';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();const query=await searchParams;const view=['TODAY','OVERDUE','DONE','ALL'].includes(query.view||'')?query.view!:'OPEN';
 const [initial,customers,editing]=await Promise.all([listTasks(user,{status:view==='DONE'?'DONE':view==='ALL'?'ALL':'OPEN',view,customerId:query.customer}),
 db.customer.findMany({where:scope(user),select:{id:true,name:true},orderBy:{name:'asc'}}),query.task?db.task.findFirst({where:{id:query.task,...taskScope(user)},include:taskInclude}):null]);
 return <WorkspaceShell boot={boot}><TaskCenter initial={jsonForClient<TaskPage>(initial)} customers={customers} timezone={boot.settings.timezone} customerId={query.customer} initialView={view} initialEditor={editing?jsonForClient<TaskItem>(editing):query.new==='1'?null:undefined}/></WorkspaceShell>;
}
