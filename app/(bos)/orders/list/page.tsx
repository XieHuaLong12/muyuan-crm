import { BOSShell } from '@/components/bos/BOSShell';
import { OrderManagement } from '@/components/bos/OrderManagement';
import { ORDER_STATUS, type OrderStatus } from '@/lib/order-status';
import { orderList } from '@/services/order-service';
import { workspacePage } from '@/services/workspace-page';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
 const { user, boot } = await workspacePage();
 const data = await orderList(user, await searchParams);
 const stage = ORDER_STATUS[data.query.tab as OrderStatus];
 const title = data.query.payment === 'UNPAID'
  ? `${stage && data.query.tab !== 'PENDING_PAYMENT' ? `${stage} · ` : ''}待付款订单`
  : stage ? `${stage}订单` : '全部订单';
 const description = data.query.payment === 'UNPAID'
  ? `共 ${data.total} 张匹配订单 · 按定金未付筛选，包含不同生产和物流阶段。`
  : `共 ${data.total} 张匹配订单 · 查看客户、交付进度和订单详情。`;
 return <BOSShell boot={boot}><div className="bos-v2-order-list"><OrderManagement data={data} basePath="/orders/list" title={title} description={description} admin={user.role==='ADMIN'}/></div></BOSShell>;
}
