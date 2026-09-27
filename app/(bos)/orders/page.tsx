import { BOSShell } from '@/components/bos/BOSShell';
import { OrderManagement } from '@/components/bos/OrderManagement';
import { workspacePage } from '@/services/workspace-page';
import { orderList } from '@/services/order-service';
import { OrderJourney } from '@/components/bos-v2/OrderJourney';
import { db } from '@/lib/db';
import { scope } from '@/lib/auth';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();
 const data=await orderList(user,await searchParams);
 const highlights=data.orders.length?await db.order.findMany({where:{id:{in:data.orders.slice(0,4).map(order=>order.id)},customer:scope(user)},select:{id:true,deal:{select:{product:true,grossProfit:true,currency:true}}}}):[];
 const details=Object.fromEntries(highlights.map(row=>[row.id,{product:row.deal?.product||'',grossProfit:user.role==='ADMIN'&&row.deal?row.deal.grossProfit.toFixed(2):null,profitCurrency:user.role==='ADMIN'&&row.deal?row.deal.currency:null}]));
 return <BOSShell boot={boot}><OrderJourney data={data} admin={user.role==='ADMIN'} details={details}/><div className="bos-v2-order-ledger"><OrderManagement data={data}/></div></BOSShell>;
}
