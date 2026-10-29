import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { db } from '../lib/db';
import { applyProducts2026, PRICE_LIST_MATTRESS_USD, PRICE_LIST_SMART_CNY } from '../prisma/products-2026';

const NEW_MODELS = ['M-803', 'M-804', 'M-805', 'M-806', 'M-507', 'M-808', '智享-Pro', '智舒-Pro', 'E350-Ultra', '深睡-Ultra', '智安-Ultra', '云栖-Ultra', '尊界-Duo'];
const BEDS = ['C-301-228x169x96', 'C-302-227x170x96', 'C-303-226x175x108', 'C-304-225x171x99', 'C-305-231x169x101', 'C-306-222x115x93'];

function assertIsolatedDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1', 'mysql'].includes(url.hostname) && url.pathname.endsWith('_test'));
}

/** 新品与补全涉及的型号的可比对快照（不含 id 与时间戳）。 */
async function snapshot() {
  const products = await db.product.findMany({
    where: { model: { in: [...NEW_MODELS, 'M-801', 'C-301', 'C-302', 'C-303', 'C-304', 'C-305', 'C-306'] } },
    orderBy: { model: 'asc' },
    include: {
      category: { select: { code: true, parent: { select: { code: true } } } },
      materials: { orderBy: { sort: 'asc' } },
      options: true,
      moqs: { orderBy: { channel: 'asc' } },
      media: true,
      aiProfile: true,
      variants: {
        orderBy: { sku: 'asc' },
        include: { cartons: { orderBy: { sort: 'asc' } }, prices: { orderBy: [{ currency: 'asc' }, { priceListKey: 'asc' }] } },
      },
    },
  });
  return products.map(p => ({
    model: p.model, category: `${p.category.parent?.code}/${p.category.code}`, status: p.status,
    nameCn: p.nameCn, nameEn: p.nameEn, descriptionCn: p.descriptionCn,
    materials: p.materials.map(m => `${m.role}|${m.nameCn}|${m.nameEn}`),
    options: p.options.map(o => `${o.kind}|${o.nameCn}|${o.nameEn}`),
    moqs: p.moqs.map(m => `${m.channel}:${m.minQty}`),
    media: p.media.map(m => `${m.role}:${m.storageKey}`),
    searchText: p.aiProfile?.searchText,
    variants: p.variants.map(v => ({
      sku: v.sku, dims: [v.lengthCm, v.widthCm, v.heightCm], packingRaw: v.packingRaw, cartonCount: v.cartonCount,
      cbm: Number(v.cbm), cbmComputed: Number(v.cbmComputed), grossWeightKg: Number(v.grossWeightKg),
      needsReview: v.needsReview, reviewNote: v.reviewNote,
      cartons: v.cartons.map(c => `${c.lengthCm}x${c.widthCm}x${c.heightCm}x${c.cartonCount}`),
      prices: v.prices.map(pr => `${pr.priceListKey} ${pr.currency} ${pr.incoterm} ${Number(pr.unitPrice)}`),
    })),
  }));
}

/** 退回到 2026 新品导入之前（旧种子写入的状态），模拟已上线的产品库。 */
async function revertToPreviousLibrary() {
  await db.product.deleteMany({ where: { model: { in: NEW_MODELS } } });
  await db.productCategory.deleteMany({ where: { code: 'SERIES_SMART_ELECTRIC' } });
  const m801 = await db.product.findUniqueOrThrow({ where: { model: 'M-801' }, include: { variants: true } });
  await db.productMaterial.deleteMany({ where: { productId: m801.id } });
  await db.productMaterial.createMany({
    data: [
      { productId: m801.id, role: 'FILLING', nameEn: '', nameCn: '18cm独立袋装弹簧', specEn: '', sort: 0 },
      { productId: m801.id, role: 'COVER', nameEn: '', nameCn: '针织布外套', specEn: '', sort: 1 },
    ],
  });
  await db.productAiProfile.update({
    where: { productId: m801.id },
    data: { searchText: 'M-801 | Compressed Mattress M-801 | 压缩床垫 M-801 | 18cm独立袋装弹簧 | 针织布外套 | 90x200x20 120x200x20 150x200x20 180x200x20' },
  });
  for (const v of m801.variants) {
    await db.productVariant.update({
      where: { id: v.id },
      data: {
        ...(v.sku === 'M-801-90x200x20' ? { cbm: '0.1040' } : {}),
        needsReview: true, reviewNote: `[来源] 毛重取自中文报价表（${Number(v.grossWeightKg)}kg）`,
      },
    });
    await db.productPrice.deleteMany({ where: { variantId: v.id, priceListKey: PRICE_LIST_MATTRESS_USD } });
  }
  await db.productVariant.updateMany({ where: { sku: { in: BEDS } }, data: { cbm: '0.2000' } });
}

test('the product library carries the 2026 mattresses, smart mattresses and bed specs', async () => {
  assertIsolatedDatabase();
  const smart = await db.product.findMany({
    where: { category: { code: 'SERIES_SMART_ELECTRIC', parent: { code: 'SMART_MATTRESS' } }, deletedAt: null },
    select: { model: true },
  });
  assert.deepEqual(smart.map(p => p.model).sort(), ['E350-Ultra', '云栖-Ultra', '尊界-Duo', '智享-Pro', '智安-Ultra', '智舒-Pro', '深睡-Ultra'].sort());

  const pro = await db.productVariant.findUniqueOrThrow({ where: { sku: '智享-Pro-120x200' }, include: { prices: true, cartons: true } });
  assert.deepEqual([pro.lengthCm, pro.widthCm, pro.heightCm], [120, 200, null], 'the price list gives no thickness, so none is invented');
  assert.equal(pro.packingRaw, '124*204*28');
  assert.equal(Number(pro.cbm), 0.71);
  assert.deepEqual(pro.prices.map(p => [p.priceListKey, p.currency, p.incoterm, Number(p.unitPrice)]), [[PRICE_LIST_SMART_CNY, 'CNY', 'EXW', 1699]]);
  assert.match(pro.reviewNote, /^\[资料缺失\] 价格表未给床垫厚度/);

  const m507 = await db.productVariant.findUniqueOrThrow({ where: { sku: 'M-507-150x203x20' }, include: { prices: true } });
  assert.deepEqual(m507.prices.map(p => [p.currency, p.incoterm, Number(p.unitPrice)]), [['USD', 'FOB', 93.28]]);
  assert.equal(m507.needsReview, false);

  const m801 = await db.product.findUniqueOrThrow({
    where: { model: 'M-801' },
    include: { materials: { orderBy: { sort: 'asc' } }, variants: { orderBy: { sku: 'asc' }, include: { prices: { orderBy: { currency: 'asc' } } } } },
  });
  assert.equal(m801.materials.length, 8);
  assert.deepEqual([m801.materials[0].nameCn, m801.materials[0].nameEn], ['白色针织面料', 'White knitted fabric']);
  const m801Small = m801.variants.find(v => v.sku === 'M-801-90x200x20');
  assert.equal(Number(m801Small?.cbm), 0.094, 'the spec sheet volume (31×31×98) replaces the price list 0.104');
  assert.deepEqual(m801Small?.prices.map(p => [p.currency, Number(p.unitPrice)]), [['CNY', 560], ['USD', 89.55]]);
  assert.ok(m801.variants.every(v => !v.needsReview), 'the weights are now confirmed by the 2026 spec sheet');

  for (const sku of BEDS) {
    assert.equal(Number((await db.productVariant.findUniqueOrThrow({ where: { sku } })).cbm), 0.194);
  }

  const heroes = await db.productMedia.findMany({ where: { role: 'HERO', product: { model: { in: [...NEW_MODELS, 'M-801'] } } } });
  assert.equal(heroes.length, NEW_MODELS.length + 1);
  for (const media of heroes) assert.ok(existsSync(`public/${media.storageKey}`), media.storageKey);
});

test('deployment adds the 2026 products to an existing library once and keeps hand-edited specs', async () => {
  assertIsolatedDatabase();
  const expected = await snapshot();
  const handEdited = BEDS[1];
  try {
    await revertToPreviousLibrary();
    // 有人在系统里核实过 C-302 的体积
    await db.productVariant.update({ where: { sku: handEdited }, data: { cbm: '0.2500' } });

    const result = spawnSync(process.execPath, ['scripts/production-init.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, SEED_ADMIN_PASSWORD: 'different-bootstrap-password' },
      timeout: 120_000,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /2026 新品：新增 13 个型号/);
    assert.match(result.stdout, new RegExp(`保留现值未动：.*${handEdited} 的 CBM`));

    const after = await snapshot();
    const withoutHandEdit = (rows: typeof after) => rows.map(p => (p.model === 'C-302' ? { ...p, variants: p.variants.map(v => ({ ...v, cbm: 0 })) } : p));
    assert.deepEqual(withoutHandEdit(after), withoutHandEdit(expected), 'an upgraded library matches a fresh seed');
    assert.equal(Number((await db.productVariant.findUniqueOrThrow({ where: { sku: handEdited } })).cbm), 0.25, 'the hand-verified value stays');

    const again = await applyProducts2026(db);
    assert.deepEqual([again.created, again.updated], [[], []], 'a second deployment changes nothing');
  } finally {
    await db.productVariant.update({ where: { sku: handEdited }, data: { cbm: '0.1940' } });
    await applyProducts2026(db);
  }
});
