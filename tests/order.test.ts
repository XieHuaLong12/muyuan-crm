import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { ORDER_STAGES,stageProgress } from '../lib/order-status';
import { ensureOrderForDeal,orderList,orderDetail } from '../services/order-service';

test('订单进度按七段流程推导', () => {
 // 七段：下单 付款 生产 发货 运输 清关 收货
 assert.equal(ORDER_STAGES.length, 7);
 assert.deepEqual(stageProgress('PENDING_PAYMENT').done, [true, false, false, false, false, false, false]);
 assert.deepEqual(stageProgress('PRODUCING').done, [true, true, true, false, false, false, false]);
 assert.deepEqual(stageProgress('SHIPPED').done, [true, true, true, true, false, false, false]);
 assert.deepEqual(stageProgress('IN_TRANSIT').done, [true, true, true, true, true, false, false]);
 assert.deepEqual(stageProgress('COMPLETED').done, [true, true, true, true, true, true, true]);
 assert.equal(stageProgress('CANCELLED').cancelled, true);
});

test('成交自动建单：幂等、人民币换算、按客户隔离', async () => {
 const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
 const actor = { id: admin.id, name: admin.name, email: admin.email, role: 'ADMIN' as const };
 const rate = (await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { usdCnyRate: true } })).usdCnyRate;

 const customer = await db.customer.create({ data: { name: `订单测试客户 ${Date.now()}`, ownerId: admin.id, source: 'OTHER', country: 'UAE', stage: 'WON' } });
 const deal = await db.deal.create({
  data: { customerId: customer.id, orderNumber: `TEST-${Date.now()}`, dealAmount: new Prisma.Decimal(1000), productCost: new Prisma.Decimal(600), grossProfit: new Prisma.Decimal(400), grossMargin: new Prisma.Decimal(0.4), currency: 'USD', dealDate: new Date('2026-09-25T00:00:00.000Z') },
 });

 try {
  const input = { dealId: deal.id, customerId: customer.id, amount: deal.dealAmount, currency: 'USD', orderDate: deal.dealDate, createdBy: admin.id };
  const first = await db.$transaction(tx => ensureOrderForDeal(tx, input));
  // 幂等：同一笔成交重复调用不会产生第二张订单
  const second = await db.$transaction(tx => ensureOrderForDeal(tx, input));
  assert.equal(first.id, second.id);
  assert.equal(await db.order.count({ where: { dealId: deal.id } }), 1);

  const order = await db.order.findUniqueOrThrow({ where: { id: first.id } });
  // 订单号形如 LV20260925-001
  assert.match(order.orderNo, /^LV\d{8}-\d{3}$/);
  // 美元成交按设置里的汇率换算成人民币，同时保留原币金额
  assert.equal(order.amountRMB.toFixed(2), new Prisma.Decimal(1000).mul(rate).toFixed(2));
  assert.equal(order.sourceAmount?.toFixed(2), '1000.00');
  assert.equal(order.currency, 'USD');
  // 新单默认待付款、未投产、未发货
  assert.equal(order.status, 'PENDING_PAYMENT');
  assert.equal(order.paymentStatus, 'UNPAID');

  // 管理员能看到
  const seen = await orderList(actor, { q: order.orderNo });
  assert.equal(seen.orders.length, 1);
  assert.equal(seen.orders[0].amountRMB, order.amountRMB.toFixed(2));
  // 订单列表不返回产品信息
  assert.equal(Object.keys(seen.orders[0]).includes('product'), false);

  const detail = await orderDetail(actor, order.id);
  assert.equal(detail.customer.country, 'UAE');
  assert.equal(detail.deposit, '未付');
  assert.equal(detail.balance, '未付');

  // 销售看不到别人客户的订单
  const sales = { ...actor, id: 'order-test-other-sales', role: 'SALES' as const };
  const hidden = await orderList(sales, { q: order.orderNo });
  assert.equal(hidden.orders.length, 0);
  await assert.rejects(() => orderDetail(sales, order.id), (e: { status?: number }) => e.status === 404);

  // 提醒口径：定金未付计入「待付款」
  const reminder = await orderList(actor, { q: order.orderNo });
  assert.ok(reminder.reminders.pendingPayment >= 1);
 } finally {
  await db.order.deleteMany({ where: { customerId: customer.id } });
  await db.deal.delete({ where: { id: deal.id } });
  await db.customer.delete({ where: { id: customer.id } });
 }
});
