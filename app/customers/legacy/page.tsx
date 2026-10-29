import { BOSShell } from '@/components/bos/BOSShell';
import { Workspace } from '@/components/workspace';
import { workspacePage } from '@/services/workspace-page';
import { customerColumns } from '@/services/user-view-service';
import { Reveal,MOTION_DELAY } from '@/components/ui/motion';
export const dynamic='force-dynamic';
// 旧客户：2026-10-01 之前询盘的客户（lib/customer-group.ts）。和新客户同一个列表，只是另一组：
// 照常聊天、报价、下单，但不参与话术测试，也不进今日工作。打开客户档案仍是 /customers/:id。
export default async function Page(){
 const {user,boot}=await workspacePage();
 const {columns}=await customerColumns(user);
 return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}><Workspace initialBoot={boot} pageOverride="customers" customerGroup="legacy" customerColumns={columns}/></Reveal></BOSShell>;
}
