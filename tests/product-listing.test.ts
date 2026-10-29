import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db } from '../lib/db';
import {
  createProduct, jpegSize, listingSummary, MANUAL_PRICE_LIST, productEditor, readProductImage, setListing, updateProduct, uploadProductImage,
} from '../services/product-admin-service';
import { quoteBuilderData } from '../services/itemized-quote-service';

const photo = () => new File([readFileSync('public/products/M-801.jpg')], 'mattress.jpg', { type: 'image/jpeg' });
/** 只有文件头的 JPEG：256 × 256。 */
const smallJpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x01, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9])], 'small.jpg', { type: 'image/jpeg' });

async function actors(tag: string) {
  const adminRow = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const salesRow = await db.user.create({ data: { name: `Listing sales ${tag}`, email: `listing-sales-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  return {
    admin: { id: adminRow.id, name: adminRow.name, email: adminRow.email, role: 'ADMIN' },
    sales: { id: salesRow.id, name: salesRow.name, email: salesRow.email, role: 'SALES' },
  };
}

const inCatalog = async (user: { id: string; name: string; email: string; role: string }, model: string) =>
  (await quoteBuilderData(user)).catalog.filter(v => v.model === model);

test('auto listing waits for photo, size and price; only listed products reach the quote builder', async () => {
  const tag = randomUUID().slice(0, 8);
  const { admin, sales } = await actors(tag);
  const model = `T-${tag}`;
  const base = {
    categoryCode: 'SERIES_M_MATTRESS', listingMode: 'AUTO', incoterm: 'FOB',
    materials: [{ cn: '白色针织面料', en: 'White knitted fabric' }, { cn: '18CM高2.0线独立袋装弹簧', en: '18 cm pocket springs' }],
  };
  const keys: string[] = [];
  try {
    const first = { lengthCm: 90, widthCm: 200, heightCm: 20, packingRaw: '31*31*98', cbm: '', grossWeightKg: 22, priceUsd: 80 };
    await assert.rejects(createProduct(sales, { model, ...base, variants: [first] }), /管理员/);
    const created = await createProduct(admin, { model, ...base, variants: [first] });
    assert.equal(created.status, 'DRAFT', 'no photo yet');
    assert.deepEqual((await listingSummary(created.id)).missing, ['主图']);
    await assert.rejects(createProduct(admin, { model, ...base, variants: [first] }), /已存在/);

    const variant = await db.productVariant.findFirstOrThrow({ where: { product: { model } }, include: { prices: true, cartons: true } });
    assert.equal(variant.sku, `${model}-90x200x20`);
    assert.equal(Number(variant.cbm), Number(variant.cbmComputed), 'an empty CBM follows the carton');
    assert.equal(variant.cartons.length, 1);
    assert.deepEqual(variant.prices.map(p => [p.priceListKey, p.currency, p.incoterm, Number(p.unitPrice)]), [[MANUAL_PRICE_LIST, 'USD', 'FOB', 80]]);
    assert.equal((await inCatalog(admin, model)).length, 0, 'a product waiting for its photo is not quotable');

    const uploaded = await uploadProductImage(admin, created.id, photo());
    keys.push(uploaded.storageKey);
    assert.equal(uploaded.status, 'ACTIVE', 'complete, so it goes live by itself');
    assert.match(uploaded.storageKey, /^media\/products\/[0-9a-f-]{36}\.jpg$/);
    const stored = await readProductImage(uploaded.storageKey.split('/').pop() as string);
    assert.equal(stored.data.length, readFileSync('public/products/M-801.jpg').length);
    const listed = await inCatalog(sales, model);
    assert.deepEqual(listed.map(v => [v.image, v.prices.USD]), [[uploaded.storageKey, 80]]);

    // 清空价格：资料不齐，自动回到待上架
    const editor = await productEditor(admin, created.id);
    const id = editor.product!.variants[0].id;
    const cleared = await updateProduct(admin, created.id, { ...base, variants: [{ ...first, id, priceUsd: '' }] });
    assert.equal(cleared.status, 'DRAFT');
    assert.equal((await db.productPrice.findFirstOrThrow({ where: { variantId: id } })).status, 'ARCHIVED');

    // 改尺寸、补人民币价、加一个规格：改过的规格算人工核对过
    const edited = await updateProduct(admin, created.id, {
      ...base,
      variants: [
        { ...first, id, lengthCm: 120, packingRaw: '31*31*128', priceUsd: '', priceCny: 590 },
        { lengthCm: 150, widthCm: 200, heightCm: 20, packingRaw: '31*31*158', cbm: 0.152, grossWeightKg: 32, priceUsd: 95 },
      ],
    });
    assert.equal(edited.status, 'ACTIVE');
    const rows = await db.productVariant.findMany({ where: { product: { model }, deletedAt: null }, orderBy: { sku: 'asc' }, include: { prices: { where: { status: 'ACTIVE' } } } });
    assert.deepEqual(rows.map(r => r.sku), [`${model}-120x200x20`, `${model}-150x200x20`], 'the code follows the new size');
    assert.match(rows[0].reviewNote, /\[已确认\]/);
    assert.equal(rows[0].needsReview, false);
    assert.deepEqual(rows[0].prices.map(p => [p.currency, Number(p.unitPrice)]), [['CNY', 590]]);

    // 删掉第二个规格：软删除，不再出现在报价里
    await updateProduct(admin, created.id, { ...base, variants: [{ ...first, id, lengthCm: 120, packingRaw: '31*31*128', priceUsd: '', priceCny: 590 }] });
    assert.equal(await db.productVariant.count({ where: { product: { model }, deletedAt: null } }), 1);
    assert.equal((await inCatalog(admin, model)).length, 1);

    // 手动下架：上架方式改为手动，资料再齐全也不会被自动上架
    await assert.rejects(setListing(sales, created.id, { action: 'UNLIST' }), /管理员/);
    const unlisted = await setListing(admin, created.id, { action: 'UNLIST' });
    assert.deepEqual([unlisted.status, unlisted.listingMode], ['ARCHIVED', 'MANUAL']);
    await updateProduct(admin, created.id, { ...base, listingMode: 'MANUAL', variants: [{ ...first, id, lengthCm: 120, packingRaw: '31*31*128', priceUsd: 88, priceCny: 590 }] });
    assert.equal((await listingSummary(created.id)).status, 'ARCHIVED');
    assert.equal((await inCatalog(admin, model)).length, 0);
    assert.deepEqual((await setListing(admin, created.id, { action: 'LIST' })).status, 'ACTIVE');
    assert.deepEqual(await setListing(admin, created.id, { action: 'AUTO' }), { id: created.id, status: 'ACTIVE', listingMode: 'AUTO', missing: [] });

    // 再换一张主图：新地址，旧图降为图库保留给历史报价单
    const second = await uploadProductImage(admin, created.id, photo());
    keys.push(second.storageKey);
    const media = await db.productMedia.findMany({ where: { product: { model } }, orderBy: { sort: 'asc' } });
    assert.deepEqual(media.map(m => [m.role, m.storageKey]), [['HERO', second.storageKey], ['GALLERY', uploaded.storageKey]]);
  } finally {
    await db.product.deleteMany({ where: { model } });
    await db.productImageFile.deleteMany({ where: { storageKey: { in: keys } } });
    await db.user.delete({ where: { id: sales.id } });
  }
});

test('product photos must be the 1200 × 900 JPEG the page produces, and file names are checked', async () => {
  const tag = randomUUID().slice(0, 8);
  const { admin, sales } = await actors(tag);
  const product = await db.product.findFirstOrThrow({ where: { model: 'M-802' } });
  try {
    assert.deepEqual(jpegSize(new Uint8Array(readFileSync('public/products/M-801.jpg'))), { width: 1200, height: 900 });
    await assert.rejects(uploadProductImage(sales, product.id, photo()), /管理员/);
    await assert.rejects(uploadProductImage(admin, product.id, smallJpeg()), /1200 × 900/);
    await assert.rejects(uploadProductImage(admin, product.id, new File(['not an image'], 'a.jpg', { type: 'image/jpeg' })), /JPEG/);
    await assert.rejects(readProductImage('../../etc/passwd'), /图片不存在/);
    await assert.rejects(readProductImage(`${randomUUID()}.jpg`), /图片不存在/);
    assert.equal(await db.productMedia.count({ where: { productId: product.id } }), 0, 'nothing was stored for M-802');
  } finally {
    await db.user.delete({ where: { id: sales.id } });
  }
});
