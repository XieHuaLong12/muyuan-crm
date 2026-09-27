import { BOSShell } from '@/components/bos/BOSShell';
import { OrderManagement } from '@/components/bos/OrderManagement';
import { workspacePage } from '@/services/workspace-page';
import { orderList } from '@/services/order-service';
import { OrderJourney } from '@/components/bos-v2/OrderJourney';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();
 const data=await orderList(user,await searchParams);
 return <BOSShell boot={boot}><OrderJourney data={data} admin={user.role==='ADMIN'}/><div className="bos-v2-order-ledger"><OrderManagement data={data}/></div></BOSShell>;
}
