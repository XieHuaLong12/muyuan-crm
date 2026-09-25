import { BOSShell } from '@/components/bos/BOSShell';
import { OrderManagement } from '@/components/bos/OrderManagement';
import { workspacePage } from '@/services/workspace-page';
import { orderList } from '@/services/order-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();
 return <BOSShell boot={boot}><OrderManagement data={await orderList(user,await searchParams)}/></BOSShell>;
}
