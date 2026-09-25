import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { ORDER_STAGES,ORDER_STATUS,PAYMENT_STATUS,PRODUCTION_STATUS,SHIPPING_STATUS,stageProgress,type OrderStatus } from '@/lib/order-status';
// 供 API 与导出复用
export { ORDER_STAGES,ORDER_STATUS,PAYMENT_STATUS,PRODUCTION_STATUS,SHIPPING_STATUS,stageProgress };
export type { OrderStatus };

/**
 * 订单管理
 *
 * 订单由 CRM 产生：客户阶段变成「已成交」时（在当前系统里只能通过新增成交订单触发）
 * 自动为该笔成交创建订单，并关联客户、国家、联系方式与成交记录。
 * 一笔成交对应一张订单（Order.dealId 唯一），复购产生新成交因而产生新订单。
 *
 * 七段固定流程：下单 → 付款 → 生产 → 发货 → 运输 → 清关 → 收货
 * 进度由 status 推导，不另存冗余字段，避免两者不一致。
 *
 * 本阶段不含物流 API、支付系统与 AI 分析。
 */

export const orderQuery = z.object({
  tab: z.enum(['ALL', 'PENDING_PAYMENT', 'PRODUCING', 'SHIPPED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED']).default('ALL'),
  q: z.string().trim().max(100).default(''),
  country: z.string().trim().max(60).default(''),
  from: z.string().trim().max(20).default(''),
  to: z.string().trim().max(20).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

const PAGE_SIZE = 20;

function dateRange(from: string, to: string) {
  const range: Prisma.DateTimeFilter = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) range.gte = new Date(`${from}T00:00:00.000Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) range.lte = new Date(`${to}T23:59:59.999Z`);
  return Object.keys(range).length ? range : undefined;
}

/** 订单只读权限与客户一致：管理员看全部，销售只看自己的客户。 */
function orderWhere(user: Actor, extra: Prisma.OrderWhereInput = {}): Prisma.OrderWhereInput {
  return { customer: scope(user), ...extra };
}

export async function orderList(user: Actor, input: unknown = {}) {
  const query = orderQuery.parse(input);
  const range = dateRange(query.from, query.to);

  const base: Prisma.OrderWhereInput = {
    ...(query.tab === 'ALL' ? {} : { status: query.tab }),
    ...(query.country ? { customer: { ...scope(user), country: query.country } } : {}),
    ...(range ? { orderDate: range } : {}),
    ...(query.q
      ? {
          OR: [
            { orderNo: { contains: query.q } },
            { customer: { ...scope(user), OR: [{ name: { contains: query.q } }, { companyName: { contains: query.q } }, { country: { contains: query.q } }] } },
          ],
        }
      : {}),
  };

  const where = orderWhere(user, base);
  const now = new Date();

  const [rows, total, tabCounts, countries] = await Promise.all([
    db.order.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, companyName: true, country: true, whatsapp: true, email: true, phone: true } },
        deal: { select: { id: true, orderNumber: true, dealDate: true, currency: true, dealAmount: true } },
      },
      orderBy: [{ orderDate: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.order.count({ where }),
    Promise.all(
      (Object.keys(ORDER_STATUS) as OrderStatus[]).map(async key => ({
        key,
        count: await db.order.count({ where: orderWhere(user, { status: key }) }),
      })),
    ),
    db.order.findMany({
      where: orderWhere(user),
      select: { customer: { select: { country: true } } },
      distinct: ['customerId'],
    }),
  ]);

  const orderAll = await db.order.findMany({ where: orderWhere(user), select: { status: true, paymentStatus: true, estimatedDelivery: true } });
  const reminders = {
    // 待付款：定金未付
    pendingPayment: orderAll.filter(o => o.paymentStatus === 'UNPAID' && o.status !== 'CANCELLED').length,
    // 待发货：生产已完成或进行中，尚未发货
    pendingShipment: orderAll.filter(o => o.status === 'PRODUCING').length,
    // 物流异常：运输中但预计到货已过
    shippingException: orderAll.filter(o => o.status === 'IN_TRANSIT' && o.estimatedDelivery && o.estimatedDelivery < now).length,
    // 待收款：定金已付、尾款未收
    pendingCollection: orderAll.filter(o => o.paymentStatus === 'DEPOSIT_PAID' && o.status !== 'CANCELLED').length,
  };

  return {
    query,
    pageSize: PAGE_SIZE,
    total,
    tabs: (Object.keys(ORDER_STATUS) as OrderStatus[]).map(key => ({
      key,
      label: ORDER_STATUS[key],
      count: tabCounts.find(t => t.key === key)?.count ?? 0,
    })),
    allCount: tabCounts.reduce((sum, t) => sum + t.count, 0),
    countries: [...new Set(countries.map(c => c.customer.country).filter(Boolean))].sort(),
    reminders,
    orders: rows.map(order => ({
      id: order.id,
      orderNo: order.orderNo,
      amountRMB: order.amountRMB.toFixed(2),
      currency: order.currency,
      sourceAmount: order.sourceAmount ? order.sourceAmount.toFixed(2) : null,
      status: order.status,
      statusLabel: ORDER_STATUS[order.status as OrderStatus] ?? order.status,
      paymentStatus: order.paymentStatus,
      paymentLabel: PAYMENT_STATUS[order.paymentStatus as keyof typeof PAYMENT_STATUS] ?? order.paymentStatus,
      productionLabel: PRODUCTION_STATUS[order.productionStatus as keyof typeof PRODUCTION_STATUS] ?? order.productionStatus,
      shippingLabel: SHIPPING_STATUS[order.shippingStatus as keyof typeof SHIPPING_STATUS] ?? order.shippingStatus,
      orderDate: order.orderDate.toISOString(),
      estimatedDelivery: order.estimatedDelivery ? order.estimatedDelivery.toISOString() : null,
      overdue: Boolean(order.estimatedDelivery && order.estimatedDelivery < now && order.status !== 'COMPLETED' && order.status !== 'CANCELLED'),
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        companyName: order.customer.companyName,
        country: order.customer.country,
        whatsapp: order.customer.whatsapp,
        email: order.customer.email,
        phone: order.customer.phone,
      },
      progress: stageProgress(order.status),
    })),
  };
}

export async function orderDetail(user: Actor, id: string) {
  const order = await db.order.findFirst({
    where: orderWhere(user, { id }),
    include: {
      customer: {
        select: { id: true, name: true, companyName: true, country: true, countryCode: true, city: true, whatsapp: true, email: true, phone: true, language: true, stage: true },
      },
      deal: { select: { id: true, orderNumber: true, dealDate: true, currency: true, dealAmount: true, product: true, productModel: true, quantity: true } },
    },
  });
  if (!order) throw new HttpError(404, '订单不存在或无权查看');

  const quotations = await db.quotation.findMany({
    where: { customerId: order.customerId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, quoteNumber: true, product: true, quantity: true, unitPrice: true, currency: true, status: true, sentAt: true, createdAt: true },
  });

  return {
    id: order.id,
    orderNo: order.orderNo,
    amountRMB: order.amountRMB.toFixed(2),
    currency: order.currency,
    sourceAmount: order.sourceAmount ? order.sourceAmount.toFixed(2) : null,
    status: order.status,
    statusLabel: ORDER_STATUS[order.status as OrderStatus] ?? order.status,
    paymentLabel: PAYMENT_STATUS[order.paymentStatus as keyof typeof PAYMENT_STATUS] ?? order.paymentStatus,
    productionLabel: PRODUCTION_STATUS[order.productionStatus as keyof typeof PRODUCTION_STATUS] ?? order.productionStatus,
    shippingLabel: SHIPPING_STATUS[order.shippingStatus as keyof typeof SHIPPING_STATUS] ?? order.shippingStatus,
    // 30% 定金 / 70% 尾款：由 paymentStatus 推导，不额外存字段
    deposit: order.paymentStatus === 'UNPAID' ? '未付' : '已付',
    balance: order.paymentStatus === 'PAID' ? '已付' : '未付',
    orderDate: order.orderDate.toISOString(),
    estimatedDelivery: order.estimatedDelivery ? order.estimatedDelivery.toISOString() : null,
    notes: order.notes,
    progress: stageProgress(order.status),
    customer: order.customer,
    deal: order.deal
      ? {
          id: order.deal.id,
          orderNumber: order.deal.orderNumber,
          dealDate: order.deal.dealDate.toISOString(),
          currency: order.deal.currency,
          dealAmount: order.deal.dealAmount.toFixed(2),
          product: order.deal.product,
          productModel: order.deal.productModel,
          quantity: order.deal.quantity,
        }
      : null,
    quotations: quotations.map(q => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      product: q.product,
      quantity: q.quantity,
      unitPrice: q.unitPrice.toFixed(2),
      currency: q.currency,
      status: q.status,
      sentAt: q.sentAt ? q.sentAt.toISOString() : null,
      createdAt: q.createdAt.toISOString(),
    })),
  };
}

/** 订单号：LV + 日期 + 三位序号，例如 LV20260925-001。 */
export async function nextOrderNo(date: Date): Promise<string> {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `LV${day}-`;
  const last = await db.order.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: 'desc' },
    select: { orderNo: true },
  });
  const seq = last ? Number(last.orderNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

/**
 * 客户成交后自动建单。按 dealId 幂等：重复调用不会产生第二张订单。
 * 在成交事务内调用，保证「有成交必有订单」。
 */
export async function ensureOrderForDeal(
  tx: Prisma.TransactionClient,
  input: { dealId: string; customerId: string; amount: Prisma.Decimal | number; currency: string; orderDate: Date; createdBy: string },
) {
  const existing = await tx.order.findUnique({ where: { dealId: input.dealId }, select: { id: true } });
  if (existing) return existing;

  const setting = await tx.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { usdCnyRate: true } });
  const source = new Prisma.Decimal(input.amount);
  // 金额统一以人民币展示：人民币成交直接采用，其他币种按设置里的汇率换算。
  const amountRMB =
    input.currency === 'CNY'
      ? source
      : input.currency === 'USD'
        ? source.mul(setting.usdCnyRate)
        : source;

  const orderNo = await nextOrderNoInTx(tx, input.orderDate);
  return tx.order.create({
    data: {
      orderNo,
      customerId: input.customerId,
      dealId: input.dealId,
      amountRMB: amountRMB.toDecimalPlaces(2),
      currency: input.currency,
      sourceAmount: source.toDecimalPlaces(2),
      status: 'PENDING_PAYMENT',
      paymentStatus: 'UNPAID',
      productionStatus: 'NOT_STARTED',
      shippingStatus: 'NOT_SHIPPED',
      orderDate: input.orderDate,
      notes: '',
      createdBy: input.createdBy,
    },
    select: { id: true, orderNo: true },
  });
}

/** nextOrderNo 的事务版本，避免在成交事务里再开一个连接。 */
async function nextOrderNoInTx(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `LV${day}-`;
  const last = await tx.order.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: 'desc' },
    select: { orderNo: true },
  });
  const seq = last ? Number(last.orderNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}
