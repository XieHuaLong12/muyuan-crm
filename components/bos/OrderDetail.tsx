import { IdentityTimeline } from './IdentityTimeline';
import { CancelOrderButton } from './CancelOrderButton';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card,Header } from '@/components/ui/bos';
import { ORDER_STAGES } from '@/lib/order-status';
import { rmb } from '@/lib/order-format';

/** 订单详情：客户信息 · 订单信息 · 七段流程。本阶段不含物流 API 与支付系统。 */

export type OrderDetailData = {
  id: string;
  orderNo: string;
  amountRMB: string;
  currency: string;
  sourceAmount: string | null;
  status: string;
  updatedAt: string;
  statusLabel: string;
  paymentLabel: string;
  productionLabel: string;
  shippingLabel: string;
  deposit: string;
  balance: string;
  orderDate: string;
  estimatedDelivery: string | null;
  notes: string;
  progress: { done: boolean[]; cancelled: boolean };
  customer: { id: string; name: string; companyName: string; country: string; city: string | null; whatsapp: string | null; email: string | null; phone: string | null; language: string | null };
  deal: { id: string; orderNumber: string; dealDate: string; currency: string; dealAmount: string; product: string | null; productModel: string | null; quantity: number | null } | null;
  quotations: { id: string; quoteNumber: string; product: string; quantity: number; unitPrice: string; amount: string; itemized: boolean; currency: string; status: string; sentAt: string | null; createdAt: string }[];
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

export function OrderDetail({ data, timezone, admin = false }: { data: OrderDetailData; timezone: string; admin?: boolean }) {
  const completed = data.progress.done.filter(Boolean).length;
  return (
    <>
      <Header
        eyebrow="ORDER MANAGEMENT · 订单详情"
        title={data.orderNo}
        description={`${data.customer.name}${data.customer.country ? ` · ${data.customer.country}` : ''} · ${data.statusLabel} · 七段流程已完成 ${completed} / ${ORDER_STAGES.length}`}
        actions={<>{admin && data.status !== 'CANCELLED' && <CancelOrderButton orderId={data.id} orderNo={data.orderNo} updatedAt={data.updatedAt} hasDeal={!!data.deal} />}<Link className="bos-button" href="/orders"><ArrowLeft size={15} />返回订单列表</Link></>}
      />

      <div className="bos-detail-grid">
        <Card>
          <div className="bos-section-title"><div><h2>客户信息</h2><p>来自客户 CRM，自动关联</p></div></div>
          <dl className="bos-detail-list">
            <div><dt>客户名称</dt><dd><Link href={`/customers/${data.customer.id}`}>{data.customer.name}</Link></dd></div>
            <div><dt>公司</dt><dd>{data.customer.companyName || '—'}</dd></div>
            <div><dt>国家 / 城市</dt><dd>{[data.customer.country, data.customer.city].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt>WhatsApp</dt><dd>{data.customer.whatsapp || '—'}</dd></div>
            <div><dt>邮箱</dt><dd>{data.customer.email || '—'}</dd></div>
            <div><dt>电话</dt><dd>{data.customer.phone || '—'}</dd></div>
          </dl>
        </Card>

        <Card>
          <div className="bos-section-title"><div><h2>订单信息</h2><p>金额统一以人民币展示</p></div></div>
          <dl className="bos-detail-list">
            <div><dt>订单金额</dt><dd className="bos-detail-amount">{rmb(data.amountRMB)}</dd></div>
            <div><dt>付款方式</dt><dd>先付定金、发货前付清尾款</dd></div>
            <div><dt>定金状态</dt><dd>{data.deposit}</dd></div>
            <div><dt>尾款状态</dt><dd>{data.balance}</dd></div>
            <div><dt>下单日期</dt><dd>{day(data.orderDate)}</dd></div>
            <div><dt>预计到货</dt><dd>{day(data.estimatedDelivery)}</dd></div>
            <div><dt>付款 / 生产 / 物流</dt><dd>{data.paymentLabel} · {data.productionLabel} · {data.shippingLabel}</dd></div>
            {data.deal && (
              <div>
                <dt>关联成交</dt>
                <dd>{data.deal.orderNumber} · {data.deal.currency} {data.deal.dealAmount}
                  {data.deal.product ? ` · ${data.deal.product}` : ''}
                  {data.deal.productModel ? ` (${data.deal.productModel})` : ''}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      <IdentityTimeline orderId={data.id} timezone={timezone}/>
      <Card>
        <div className="bos-section-title">
          <div>
            <h2>订单流程</h2>
            <p>下单 → 付款 → 生产 → 发货 → 运输 → 清关 → 收货</p>
          </div>
          <span className="bos-status">{data.statusLabel}</span>
        </div>
        {data.progress.cancelled ? (
          <p className="bos-footnote">该订单已取消，流程不再推进。</p>
        ) : (
          <ol className="bos-flow">
            {ORDER_STAGES.map((stage, index) => (
              <li key={stage} className={data.progress.done[index] ? 'is-done' : ''}>
                <span className="bos-flow-dot" />
                <div>
                  <strong>{stage}</strong>
                  <small>{data.progress.done[index] ? '已完成' : '待推进'}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <div className="bos-section-title"><div><h2>报价记录</h2><p>该客户的历史报价，用于核对本单价格来源</p></div></div>
        {data.quotations.length ? (
          <ul className="bos-quote-list">
            {data.quotations.map(q => (
              <li key={q.id}>
                <div>
                  {q.itemized ? <Link href={`/products/quotes/${q.id}`}><strong>{q.quoteNumber}</strong></Link> : <strong>{q.quoteNumber}</strong>}
                  <small>{q.product} · {q.quantity} 件 · {day(q.createdAt)}</small>
                </div>
                <span>{q.currency} {q.amount}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="bos-footnote">该客户暂无报价记录。</p>
        )}
      </Card>

      {data.notes && (
        <Card>
          <div className="bos-section-title"><div><h2>备注</h2></div></div>
          <p className="bos-footnote">{data.notes}</p>
        </Card>
      )}
    </>
  );
}
