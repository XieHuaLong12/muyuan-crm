import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { productList,productDetail } from '../services/product-service';
import { marginOverview,productCostSummary,upsertCost,setExchangeRate } from '../services/product-cost-service';

/**
 * 成本是全公司最敏感的数据，这里主要防两件事：
 *   1. 非管理员能拿到成本（接口层必须 403）
 *   2. 成本意外出现在普通产品接口的返回里（泄漏）
 */
test('成本仅管理员可见，且不会泄漏到普通产品接口', async () => {
 const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
 const actor = { id: admin.id, name: admin.name, email: admin.email, role: 'ADMIN' as const };
 const sales = { ...actor, id: 'cost-test-sales', role: 'SALES' as const };

 const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { usdCnyRate: true } });
 const rate = setting.usdCnyRate;

 // 独立夹具：一个型号 + 一个变体 + 一条美元价
 const model = `TEST-COST-${Date.now()}`;
 const category = await db.productCategory.findFirstOrThrow({ where: { level: 2 } });
 const product = await db.product.create({
  data: { model, nameEn: model, nameCn: model, descriptionEn: '', descriptionCn: '', categoryId: category.id, createdBy: admin.id },
 });
 const variant = await db.productVariant.create({
  data: { productId: product.id, sku: `${model}-1`, lengthCm: 100, widthCm: 100, heightCm: 100, cbm: new Prisma.Decimal(0.5), reviewNote: '', createdBy: admin.id },
 });
 await db.productPrice.create({
  data: {
   variantId: variant.id, priceListKey: 'TEST', currency: 'USD', incoterm: 'FOB', customerTier: 'ALL', minQty: 1,
   unitPrice: new Prisma.Decimal(100), effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: admin.id,
  },
 });

 try {
  // ① 非管理员一律 403
  await assert.rejects(() => marginOverview(sales), (e: { status?: number }) => e.status === 403);
  await assert.rejects(() => productCostSummary(sales, product.id), (e: { status?: number }) => e.status === 403);
  await assert.rejects(() => upsertCost(sales, variant.id, { factoryCost: 1 }), (e: { status?: number }) => e.status === 403);
  await assert.rejects(() => setExchangeRate(sales, { rate: 7 }), (e: { status?: number }) => e.status === 403);

  // ② 管理员录入成本后，毛利率口径正确：成本取售价一半 → 毛利率 50%
  const priceCny = new Prisma.Decimal(100).mul(rate);
  const halfCost = priceCny.div(2);
  await upsertCost(actor, variant.id, { factoryCost: Number(halfCost.toFixed(2)) });

  const overview = await marginOverview(actor, { q: model });
  const row = overview.rows.find(r => r.variantId === variant.id);
  assert.ok(row, '管理员应能在毛利总览里看到该变体');
  assert.equal(row.hasCost, true);
  assert.equal(row.factory?.margin, 50);
  assert.equal(row.purchase, null, '只填了工厂成本，外购场景应为空');

  // ③ 成本不得出现在普通产品接口的返回里（序列化后全文搜索）
  const listPayload = JSON.stringify(await productList(actor, { q: model }));
  const detailPayload = JSON.stringify(await productDetail(actor, product.id));
  const costText = Number(halfCost.toFixed(2)).toFixed(2);
  assert.equal(listPayload.includes(costText), false, `产品列表不应包含成本 ${costText}`);
  assert.equal(detailPayload.includes(costText), false, `产品详情不应包含成本 ${costText}`);
  assert.equal(listPayload.includes('factoryCost'), false);
  assert.equal(detailPayload.includes('factoryCost'), false);

  // ④ 成本高于售价时毛利率为负，不应被截断或报错
  await upsertCost(actor, variant.id, { purchaseCost: Number(priceCny.mul(2).toFixed(2)) });
  const loss = await marginOverview(actor, { q: model });
  const lossRow = loss.rows.find(r => r.variantId === variant.id);
  assert.equal(lossRow?.purchase?.margin, -100);
  assert.equal(lossRow?.isLowMargin, true);
 } finally {
  await db.product.delete({ where: { id: product.id } });
 }
});
