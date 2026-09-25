import { notFound } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { Workspace } from '@/components/workspace';
import { workspacePage } from '@/services/workspace-page';
import { Reveal,MOTION_DELAY } from '@/components/ui/motion';
export const dynamic='force-dynamic';
// 客户管理 = 管档案：搜索 / 筛选 / 排序 / 分页 / 批量删除 / 回收站 / 详情 / 智能导入。
// 对话与跟进在销售工作台（/sales）里做，两个页面的职责不再重叠。
export default async function Page({params}:{params:Promise<{customerPath?:string[]}>}){
 const {customerPath}=await params;
 if(customerPath&&customerPath.length>1)notFound();
 const {boot}=await workspacePage();
 return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}><Workspace initialBoot={boot} pageOverride="customers" embedded/></Reveal></BOSShell>;
}
