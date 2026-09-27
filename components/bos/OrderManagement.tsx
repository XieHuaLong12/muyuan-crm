'use client';
import Link from 'next/link';
import { AlertTriangle,ArrowUpRight,Download,Plus } from 'lucide-react';
import { Card,EmptyState,Header,Table } from '@/components/ui/bos';
import { ORDER_STAGES } from '@/lib/order-status';

/**
 * 订单管理
 *
 * 独立模块：不引用驾驶舱的任何内容（没有问候语、没有销售漏斗、没有 AI 助手）。
 * 老板打开这一页，5 秒内能看出哪些在产、哪些已发、哪些等付款、哪些快收货。
 */

export const ORDER_TABS = [
  ['ALL', '全部订单'],
  ['PENDING_PAYMENT', '待付款'],
  ['PRODUCING', '生产中'],
  ['SHIPPED', '已发货'],
  ['IN_TRANSIT', '运输中'],
  ['COMPLETED', '已完成'],
  ['CANCELLED', '已取消'],
] as const;

export type OrderRow = {
  id: string;
  orderNo: string;
  amountRMB: string;
  currency: string;
  sourceAmount: string | null;
  product: string;
  grossProfit: string | null;
  profitCurrency: string | null;
  status: string;
  statusLabel: string;
  paymentLabel: string;
  productionLabel: string;
  shippingLabel: string;
  orderDate: string;
  estimatedDelivery: string | null;
  overdue: boolean;
  customer: { id: string; name: string; companyName: string; country: string; whatsapp: string | null; email: string | null; phone: string | null };
  progress: { done: boolean[]; cancelled: boolean };
};

export type OrdersData = {
  query: { tab: string; q: string; country: string; from: string; to: string; page: number };
  pageSize: number;
  total: number;
  tabs: { key: string; label: string; count: number }[];
  allCount: number;
  countries: string[];
  reminders: { pendingPayment: number; pendingShipment: number; shippingException: number; pendingCollection: number };
  orders: OrderRow[];
};

const STATUS_TONE: Record<string, string> = {
  PENDING_PAYMENT: 'bos-status-pending',
  PRODUCING: 'bos-status-producing',
  SHIPPED: 'bos-status-shipped',
  IN_TRANSIT: 'bos-status-transit',
  COMPLETED: 'bos-status-done',
  CANCELLED: 'bos-status-cancelled',
};

/** 金额统一人民币展示，不显示美元。 */
export function rmb(value: string | number) {
  return `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

function day(iso: string | null) {
  return iso ? iso.slice(0, 10) : '—';
}

function queryString(query: OrdersData['query'], patch: Partial<OrdersData['query']> = {}) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.tab !== 'ALL') params.set('tab', next.tab);
  if (next.q) params.set('q', next.q);
  if (next.country) params.set('country', next.country);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.page > 1) params.set('page', String(next.page));
  const text = params.toString();
  return text ? `/orders?${text}` : '/orders';
}

/** 横向进度：绿点=已完成，绿线=已经过阶段，灰点=未完成。 */
function Timeline({ progress }: { progress: OrderRow['progress'] }) {
  if (progress.cancelled) return <span className="bos-timeline-cancelled">已取消</span>;
  // 最后一个已完成节点＝当前所处阶段，给它绿色光晕脉冲
  const current = progress.done.lastIndexOf(true);
  return (
    <div className="bos-timeline" role="img" aria-label={`已完成 ${progress.done.filter(Boolean).length} / ${ORDER_STAGES.length} 个阶段`}>
      {ORDER_STAGES.map((stage, index) => (
        <div
          key={stage}
          className={`bos-timeline-step${progress.done[index] ? ' is-done' : ''}${progress.done[index + 1] ? ' is-linked' : ''}${index === current ? ' is-current' : ''}`}
        >
          <span className="bos-timeline-dot" />
          <small>{stage}</small>
        </div>
      ))}
    </div>
  );
}

export function OrderManagement({ data }: { data: OrdersData }) {
  const { query, reminders, tabs } = data;
  const reminderRows = [
    ['待付款', reminders.pendingPayment],
    ['待发货', reminders.pendingShipment],
    ['物流异常', reminders.shippingException],
    ['待收款', reminders.pendingCollection],
  ] as const;

  return (
    <>
      <Header
        eyebrow="ORDER MANAGEMENT"
        title="订单管理"
        description="从下单到收货，全流程跟踪"
        actions={
          <div className="bos-order-actions">
            <Link className="bos-button bos-button-primary" href="/customers" title="订单随客户成交自动创建：在客户页新增成交订单即可">
              <Plus size={15} />新建订单
            </Link>
            <a className="bos-button" href={`/api/orders/export?${new URLSearchParams(
              Object.entries({ tab: query.tab === 'ALL' ? '' : query.tab, q: query.q, country: query.country, from: query.from, to: query.to }).filter(([, v]) => v) as [string, string][],
            ).toString()}`}>
              <Download size={15} />导出
            </a>
          </div>
        }
      />

      <nav className="bos-order-tabs motion-in" style={{ '--motion-delay': '100ms' } as React.CSSProperties} aria-label="订单状态">
        {ORDER_TABS.map(([key, label]) => {
          const count = key === 'ALL' ? data.allCount : tabs.find(t => t.key === key)?.count ?? 0;
          return (
            <Link key={key} href={queryString(query, { tab: key, page: 1 })} aria-current={query.tab === key ? 'page' : undefined}>
              {label}
              <b>{count}</b>
            </Link>
          );
        })}
      </nav>

      <form className="bos-order-filter motion-in" style={{ '--motion-delay': '200ms' } as React.CSSProperties} action="/orders">
        <input className="bos-input" type="search" name="q" aria-label="搜索订单号、客户名称或国家" placeholder="搜索订单号 / 客户名称 / 国家" defaultValue={query.q} />
        <select name="country" aria-label="国家" defaultValue={query.country}>
          <option value="">全部国家</option>
          {data.countries.map(country => (
            <option key={country} value={country}>{country}</option>
          ))}
        </select>
        <select name="tab" aria-label="全部订单阶段" defaultValue={query.tab}>
          <option value="ALL">全部订单阶段</option>
          {ORDER_TABS.slice(1).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <label className="bos-order-dates">
          <span>下单时间</span>
          <input type="date" name="from" aria-label="开始日期" defaultValue={query.from} />
          <span className="bos-order-dash">—</span>
          <input type="date" name="to" aria-label="结束日期" defaultValue={query.to} />
        </label>
        <button className="bos-button bos-button-primary" type="submit">筛选</button>
        <Link className="bos-button" href="/orders">重置</Link>
      </form>

      <div className="bos-order-layout motion-in" style={{ '--motion-delay': '400ms' } as React.CSSProperties}>
        <Card className="bos-order-table-card" data-motion={data.orders.length > 50 ? 'off' : 'on'}>
          <Table
            caption="订单列表"
            headings={['订单号', '客户名称', '国家', '订单金额', '下单日期', '预计到货', '当前状态', '订单进度', '操作']}
          >
            {data.orders.map(order => (
              <tr key={order.id} className={order.overdue ? 'bos-row-review' : undefined}>
                <td>
                  <Link href={`/orders/detail/${order.id}`}><strong>{order.orderNo}</strong></Link>
                </td>
                <td>
                  {order.customer.name}
                  {order.customer.companyName && <small>{order.customer.companyName}</small>}
                </td>
                <td>{order.customer.country || '—'}</td>
                <td className="bos-order-amount">{rmb(order.amountRMB)}</td>
                <td>{day(order.orderDate)}</td>
                <td className={order.overdue ? 'bos-overdue' : undefined}>
                  {day(order.estimatedDelivery)}
                  {order.overdue && <small>已逾期</small>}
                </td>
                <td><span className={`bos-status ${STATUS_TONE[order.status] ?? ''}`}>{order.statusLabel}</span></td>
                <td className="bos-order-progress"><Timeline progress={order.progress} /></td>
                <td>
                  <Link className="bos-order-view" href={`/orders/detail/${order.id}`}>
                    查看<ArrowUpRight size={13} />
                  </Link>
                </td>
              </tr>
            ))}
          </Table>

          {!data.orders.length && (
            <EmptyState
              title="没有匹配的订单"
              description="换个状态页签或清空筛选条件试试。订单会在客户成交时自动创建。"
              action={<Link className="bos-button" href="/orders">清空筛选</Link>}
            />
          )}

          <div className="bos-pagination">
            <span>第 {query.page} 页 · 共 {data.total} 张订单</span>
            <div>
              {query.page > 1 && <Link className="bos-button" href={queryString(query, { page: query.page - 1 })}>上一页</Link>}
              {query.page * data.pageSize < data.total && <Link className="bos-button" href={queryString(query, { page: query.page + 1 })}>下一页</Link>}
            </div>
          </div>
        </Card>

        <aside className="bos-order-side">
          <Card>
            <div className="bos-section-title">
              <div>
                <h2>订单提醒</h2>
                <p>需要你今天处理的事</p>
              </div>
            </div>
            <ul className="bos-reminder-list">
              {reminderRows.map(([label, count]) => (
                <li key={label}>
                  <span className={count > 0 ? 'is-active' : undefined}>{count > 0 && <AlertTriangle size={13} />}{label}</span>
                  <b>{count}</b>
                </li>
              ))}
            </ul>
            <p className="bos-footnote">
              待付款＝定金未付 · 待发货＝生产中 · 物流异常＝运输中但预计到货已过 · 待收款＝定金已付、尾款未收
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
