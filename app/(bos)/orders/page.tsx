import { BOSShell } from '@/components/bos/BOSShell';
import { OrderManagement } from '@/components/bos/OrderManagement';
import { ORDER_STATUS, type OrderStatus } from '@/lib/order-status';
import { orderList } from '@/services/order-service';
import { workspacePage } from '@/services/workspace-page';

export const dynamic = 'force-dynamic';

/** One order page: status tabs, filters and the ledger. The old /orders/list redirects here with its filters. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
 const { user, boot } = await workspacePage();
 const data = await orderList(user, await searchParams);
 const stage = ORDER_STATUS[data.query.tab as OrderStatus];
 const title = data.query.payment === 'UNPAID'
  ? `${stage && data.query.tab !== 'PENDING_PAYMENT' ? `${stage} · ` : ''}待付款订单`
  : stage ? `${stage}订单` : user.role === 'ADMIN' ? '订单' : '我的订单';
 const description = data.query.payment === 'UNPAID'
  ? `共 ${data.total} 张匹配订单 · 按定金未付筛选，包含不同生产和物流阶段。`
  : `共 ${data.total} 张订单 · 订单随客户成交自动创建，在这里跟踪付款、生产和物流。`;
 return <BOSShell boot={boot}><OrderManagement data={data} title={title} description={description} admin={user.role === 'ADMIN'}/></BOSShell>;
}
