import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { db } from '../lib/db';
import { applyCatalog2026 } from '../prisma/catalog-2026.mjs';

type Group = { from: Record<string, unknown>; to: Record<string, unknown> };
type VariantChange = {
  sku: string;
  model: string;
  identity?: Group;
  label?: Group;
  packing?: Group;
  review?: Group;
  addPrices?: { priceListKey: string; currency: string; unitPrice: number }[];
};
type ProductChange = { model: string; materials?: Group; options?: Group; searchText?: Group };
const changes = JSON.parse(readFileSync('docs/product-os/catalog-2026-changes.json', 'utf8')) as {
  variants: VariantChange[];
  products: ProductChange[];
};

function assertIsolatedDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1', 'mysql'].includes(url.hostname) && url.pathname.endsWith('_test'));
}

/** Y 系列产品库的可比对快照（不含自增 id 与时间戳）。 */
async function snapshot() {
  const products = await db.product.findMany({
    where: { model: { startsWith: 'Y-' } },
    orderBy: { model: 'asc' },
    include: {
      materials: { orderBy: { sort: 'asc' } },
      options: { orderBy: { sort: 'asc' } },
      aiProfile: true,
      variants: {
        orderBy: { sku: 'asc' },
        include: { cartons: { orderBy: { sort: 'asc' } }, prices: { orderBy: [{ currency: 'asc' }, { priceListKey: 'asc' }] } },
      },
    },
  });
  return products.map(p => ({
    model: p.model,
    materials: p.materials.map(({ role, nameEn, nameCn, sort }) => ({ role, nameEn, nameCn, sort })),
    options: p.options.map(({ kind, code, nameEn, nameCn, sort }) => ({ kind, code, nameEn, nameCn, sort })),
    searchText: p.aiProfile?.searchText,
    variants: p.variants.map(v => ({
      id: v.id,
      sku: v.sku,
      dims: [v.lengthCm, v.widthCm, v.heightCm],
      labelCn: v.labelCn,
      packingRaw: v.packingRaw,
      cartonCount: v.cartonCount,
      cbm: Number(v.cbm),
      cbmComputed: Number(v.cbmComputed),
      grossWeightKg: Number(v.grossWeightKg),
      grossWeightRaw: v.grossWeightRaw,
      needsReview: v.needsReview,
      reviewNote: v.reviewNote,
      cartons: v.cartons.map(({ lengthCm, widthCm, heightCm, cartonCount, grossWeightKg }) => ({
        lengthCm, widthCm, heightCm, cartonCount, grossWeightKg: grossWeightKg === null ? null : Number(grossWeightKg),
      })),
      prices: v.prices.map(price => `${price.priceListKey} ${price.currency} ${Number(price.unitPrice)}`),
    })),
  }));
}

/** 把产品库退回旧种子（图册校正之前）写入的值，模拟已上线的库。 */
async function revertToPreviousSeed() {
  const productIds = new Map((await db.product.findMany({ where: { model: { startsWith: 'Y-' } } })).map(p => [p.model, p.id]));
  for (const change of changes.variants) {
    const variant = await db.productVariant.findUniqueOrThrow({ where: { sku: (change.identity?.to.sku as string) ?? change.sku } });
    const { model, ...identity } = (change.identity?.from ?? {}) as { model?: string };
    await db.productVariant.update({
      where: { id: variant.id },
      data: {
        ...identity,
        ...(model ? { productId: productIds.get(model) } : {}),
        ...change.label?.from,
        ...change.packing?.from,
        ...change.review?.from,
      },
    });
    for (const price of change.addPrices ?? []) {
      await db.productPrice.deleteMany({ where: { variantId: variant.id, priceListKey: price.priceListKey, currency: price.currency } });
    }
  }
  for (const change of changes.products) {
    const productId = productIds.get(change.model) as string;
    if (change.materials) {
      await db.productMaterial.deleteMany({ where: { productId } });
      await db.productMaterial.createMany({ data: (change.materials.from as unknown as object[]).map(row => ({ ...row, productId })) as never });
    }
    if (change.options) {
      await db.productOption.deleteMany({ where: { productId } });
      await db.productOption.createMany({ data: (change.options.from as unknown as object[]).map(row => ({ ...row, productId })) as never });
    }
    if (change.searchText) {
      await db.productAiProfile.update({ where: { productId }, data: { searchText: change.searchText.from as unknown as string } });
    }
  }
}

const modelOf = async (sku: string) =>
  (await db.productVariant.findUniqueOrThrow({ where: { sku }, include: { product: true } })).product.model;

test('deployment corrects a library seeded before the 2026 catalog, keeps record ids, and only once', async () => {
  assertIsolatedDatabase();
  const expected = await snapshot();
  const sofa290 = await db.productVariant.findUniqueOrThrow({ where: { sku: 'Y-616-290x95x85' } });
  try {
    await revertToPreviousSeed();
    // 旧库：Y-615 是 290 × 95 × 85，Y-616 是 105 / 150 / 210 宽的单座
    assert.equal(await modelOf('Y-615-290x95x85'), 'Y-615');
    assert.equal(await modelOf('Y-616-105x105x87'), 'Y-616');
    assert.equal(await db.productPrice.count({ where: { variantId: sofa290.id, currency: 'CNY' } }), 0);

    const result = spawnSync(process.execPath, ['scripts/production-init.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, SEED_ADMIN_PASSWORD: 'different-bootstrap-password' },
      timeout: 120_000,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /图册校正：Y-615-290x95x85 → Y-616-290x95x85/);

    const corrected = await snapshot();
    assert.deepEqual(corrected, expected, 'the corrected library equals a fresh seed of the catalog');
    assert.equal(await modelOf('Y-616-290x95x85'), 'Y-616');
    assert.equal(
      (await db.productVariant.findUniqueOrThrow({ where: { sku: 'Y-616-290x95x85' } })).id,
      sofa290.id,
      'the variant moves with its USD price, costs and quote history instead of being recreated',
    );

    const again = await applyCatalog2026(db);
    assert.equal(again.applied, 0, 'a second deployment only compares');
    assert.deepEqual(again.kept, []);
  } finally {
    await applyCatalog2026(db);
  }
});

test('the catalog correction keeps fields that were corrected by hand', async () => {
  assertIsolatedDatabase();
  const change = changes.variants.find(c => c.sku === 'Y-607-260x100x62') as VariantChange;
  const original = await db.productVariant.findUniqueOrThrow({ where: { sku: 'Y-607-280x96x68' } });
  const { sku, lengthCm, widthCm, heightCm } = change.identity?.from as { sku: string; lengthCm: number; widthCm: number; heightCm: number };
  try {
    // 旧种子的尺寸，但包装 / CBM 已被人工核实改过
    await db.productVariant.update({
      where: { id: original.id },
      data: { sku, lengthCm, widthCm, heightCm, ...change.review?.from, packingRaw: '35*35*106*2pc', cbm: '0.2700', grossWeightKg: '44.00' },
    });
    const result = await applyCatalog2026(db);
    const variant = await db.productVariant.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(variant.sku, 'Y-607-280x96x68', 'the catalog size is still applied');
    assert.deepEqual([Number(variant.cbm), Number(variant.grossWeightKg)], [0.27, 44], 'hand-verified CBM and weight are kept');
    assert.equal(variant.reviewNote, change.review?.from.reviewNote, 'notes written for the catalog values are not attached to hand-edited values');
    assert.ok(result.kept.some(entry => entry.includes('包装')));
  } finally {
    await db.productVariant.update({
      where: { id: original.id },
      data: {
        sku: original.sku, lengthCm: original.lengthCm, widthCm: original.widthCm, heightCm: original.heightCm,
        packingRaw: original.packingRaw, cbm: original.cbm, grossWeightKg: original.grossWeightKg,
        needsReview: original.needsReview, reviewNote: original.reviewNote, updatedAt: original.updatedAt,
      },
    });
  }
});
