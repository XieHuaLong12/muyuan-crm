import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle } from '@/lib/http';
import { orderList,ORDER_STAGES } from '@/services/order-service';
export const dynamic='force-dynamic';

/** 导出当前筛选条件下的全部订单（不只是当前页）。 */
function cell(value: unknown) {
 return `"${String(value??'').replace(/"/g,'""')}"`;
}
export async function GET(req:NextRequest){
 return handle(async()=>{
  const user=await requireUser();
  // 一次取足够多的行用于导出；订单量级远小于此
  const data=await orderList(user,{...Object.fromEntries(req.nextUrl.searchParams),page:1});
  const header=['订单号','客户名称','公司','国家','订单金额(人民币)','下单日期','预计到货','当前状态','付款','生产','物流','已完成阶段'];
  const lines=[header.map(cell).join(',')];
  for(const o of data.orders){
   const done=ORDER_STAGES.filter((_,i)=>o.progress.done[i]);
   lines.push([o.orderNo,o.customer.name,o.customer.companyName,o.customer.country,o.amountRMB,o.orderDate.slice(0,10),o.estimatedDelivery?o.estimatedDelivery.slice(0,10):'',o.statusLabel,o.paymentLabel,o.productionLabel,o.shippingLabel,done.join(' → ')].map(cell).join(','));
  }
  // BOM 让 Excel 正确识别 UTF-8 中文
  const body='\uFEFF'+lines.join('\r\n');
  const stamp=new Date().toISOString().slice(0,10);
  return new NextResponse(body,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="orders-${stamp}.csv"`}});
 });
}
