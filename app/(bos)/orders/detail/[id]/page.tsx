import { BOSShell } from '@/components/bos/BOSShell';
import { OrderDetail } from '@/components/bos/OrderDetail';
import { workspacePage } from '@/services/workspace-page';
import { orderDetail } from '@/services/order-service';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {user,boot}=await workspacePage();
 const {id}=await params;
 return <BOSShell boot={boot}><OrderDetail timezone={boot.settings.timezone} admin={user.role==='ADMIN'} data={await orderDetail(user,id)}/></BOSShell>;
}
