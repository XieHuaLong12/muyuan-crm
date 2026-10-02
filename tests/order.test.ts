import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { ORDER_STAGES,stageProgress } from '../lib/order-status';
import { changeOrderMilestone,ensureOrderForDeal,orderList,orderDetail,orderMilestoneInput } from '../services/order-service';

test('订单进度按七段流程推导', () => {
 // 七段：下单 付款 生产 发货 运输 清关 收货
 assert.equal(ORDER_STAGES.length, 7);
 assert.deepEqual(stageProgress('PENDING_PAYMENT').done, [true, false, false, false, false, false, false]);
 assert.deepEqual(stageProgress('PRODUCING').done, [true, true, true, false, false, false, false]);
 assert.deepEqual(stageProgress('SHIPPED').done, [true, true, true, true, false, false, false]);
 assert.deepEqual(stageProgress('IN_TRANSIT').done, [true, true, true, true, true, false, false]);
 assert.deepEqual(stageProgress('COMPLETED').done, [true, true, true, true, true, true, true]);
 assert.equal(stageProgress('CANCELLED').cancelled, true);
 assert.equal(orderMilestoneInput.safeParse({ status: 'CANCELLED', expectedUpdatedAt: new Date().toISOString() }).success, false);
});

test('订单概况列表按生产、运输和付款分别筛选，分页保留未付款口径', async () => {
 const tag = randomUUID();
 const owner = await db.user.create({ data: { name: 'Order list owner', email: `order-list-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
 const customer = await db.customer.create({ data: { name: 'Order list customer', ownerId: owner.id, country: 'France' } });
 const actor = { id: owner.id, name: owner.name, email: owner.email, role: owner.role };
 try {
  const states = [
   ...Array.from({ length: 24 }, () => ({ status: 'IN_TRANSIT', paymentStatus: 'UNPAID' })),
   { status: 'PRODUCING', paymentStatus: 'UNPAID' },
   { status: 'PRODUCING', paymentStatus: 'PAID' },
   { status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' },
   { status: 'CANCELLED', paymentStatus: 'UNPAID' },
  ];
  await db.order.createMany({ data: states.map((state, index) => ({ ...state, orderNo: `LIST-${tag.replaceAll('-', '')}-${index}`, customerId: customer.id, amountRMB: 100, notes: '', createdBy: owner.id })) });
  const all = await orderList(actor);
  assert.equal(all.total, 28);
  assert.equal(all.reminders.pendingPayment, 26);
  assert.equal((await orderList(actor, { tab: 'PRODUCING' })).total, 2);
  assert.equal((await orderList(actor, { tab: 'IN_TRANSIT' })).total, 24);
  const unpaid = await orderList(actor, { payment: 'UNPAID' });
  assert.equal(unpaid.total, all.reminders.pendingPayment);
  assert.equal(unpaid.allCount, 26);
  assert.equal(unpaid.tabs.find(tab => tab.key === 'CANCELLED')?.count, 0);
  assert.ok(unpaid.orders.every(order => order.paymentStatus === 'UNPAID' && order.status !== 'CANCELLED'));
  const page2 = await orderList(actor, { payment: 'UNPAID', page: 2 });
  assert.equal(page2.total, 26);
  assert.equal(page2.orders.length, 6);
  assert.equal(new Set([...unpaid.orders, ...page2.orders].map(order => order.id)).size, 26);
  assert.equal((await orderList(actor, { payment: 'UNPAID', tab: 'PRODUCING', country: 'France' })).total, 1);
  assert.equal((await orderList({ ...actor, id: 'order-list-outsider' }, { payment: 'UNPAID' })).total, 0);
 } finally {
  await db.order.deleteMany({ where: { customerId: customer.id } });
  await db.customer.delete({ where: { id: customer.id } });
  await db.user.delete({ where: { id: owner.id } });
 }
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
  // 提醒口径：定金未付计入「待付款」
  assert.ok(seen.reminders.pendingPayment >= 1);

  const detail = await orderDetail(actor, order.id);
  assert.equal(detail.customer.country, 'UAE');
  assert.equal(detail.deposit, '未付');
  assert.equal(detail.balance, '未付');

  // 销售看不到别人客户的订单
  const sales = { ...actor, id: 'order-test-other-sales', role: 'SALES' as const };
  const hidden = await orderList(sales, { q: order.orderNo });
  assert.equal(hidden.orders.length, 0);
  await assert.rejects(() => orderDetail(sales, order.id), (e: { status?: number }) => e.status === 404);
  await assert.rejects(() => changeOrderMilestone(sales, order.id, { status: 'PRODUCING', expectedUpdatedAt: order.updatedAt.toISOString() }), (e: { status?: number }) => e.status === 404);

  // 展开行切换主阶段，同时更新相应生产/物流细项，不改付款记录。
  const moved = await changeOrderMilestone(actor, order.id, { status: 'SHIPPED', expectedUpdatedAt: order.updatedAt.toISOString() });
  assert.equal(moved.status, 'SHIPPED');
  assert.deepEqual(moved.progress.done, [true, true, true, true, false, false, false]);
  const shipped = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(shipped.productionStatus, 'DONE');
  assert.equal(shipped.shippingStatus, 'SHIPPED');
  assert.equal(shipped.paymentStatus, 'UNPAID');
  await assert.rejects(() => changeOrderMilestone(actor, order.id, { status: 'COMPLETED', expectedUpdatedAt: new Date(order.updatedAt.getTime() - 1000).toISOString() }), (e: { status?: number }) => e.status === 409);

  const delivered = await changeOrderMilestone(actor, order.id, { status: 'COMPLETED', expectedUpdatedAt: moved.updatedAt });
  assert.equal(delivered.status, 'COMPLETED');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).shippingStatus, 'DELIVERED');
  await db.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
  await assert.rejects(() => changeOrderMilestone(actor, order.id, { status: 'PRODUCING', expectedUpdatedAt: delivered.updatedAt }), (e: { status?: number }) => e.status === 409);

 } finally {
  await db.order.deleteMany({ where: { customerId: customer.id } });
  await db.deal.delete({ where: { id: deal.id } });
  await db.customer.delete({ where: { id: customer.id } });
 }
});
