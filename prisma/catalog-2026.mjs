/**
 * 按 2026 压缩沙发图册改正已有产品库（2026-10-13 业务确认：Y 系列全部以图册为准）。
 *
 * 部署不会重跑产品种子（现有资料含人工修正），所以已上线的库要靠这里逐字段改正：
 *   - Y-615 / Y-616：英文报价表把编号记反了，变体连同美元价、成本、报价记录整行移到图册编号下；
 *   - 尺寸 / 包装 / CBM / 毛重改为与图册一致的中文报价表；补上缺的人民币价；
 *   - 材料、面料、检索文本与待核对说明随之更新。
 *
 * 改正清单 docs/product-os/catalog-2026-changes.json 由「旧种子结果 → 新种子结果」逐字段比对生成。
 * 每组字段只在当前值仍等于旧种子值时才改；已是新值的跳过；其他情况视为人工改过，保留并记录。
 * 可重复执行：每次部署都会跑一遍，改完之后只剩只读比对。
 */
import { readFileSync } from 'node:fs';

const CHANGES = new URL('../docs/product-os/catalog-2026-changes.json', import.meta.url);

const num = value => (value === null || value === undefined ? null : Number(value));

/** 字段逐一比对；数值统一转 number（Decimal 列读出来是对象）。 */
function matches(current, expected) {
  return Object.entries(expected).every(([key, value]) => {
    const actual = current[key];
    if (typeof value === 'number') return num(actual) !== null && Math.abs(num(actual) - value) < 1e-6;
    return actual === value;
  });
}

/** 只比对旧值里登记过的字段（新值里另有随之重算的派生字段，如纸箱明细）。 */
const pick = (values, keys) => Object.fromEntries(keys.map(key => [key, values[key]]));

const comparable = rows => JSON.stringify(rows);

const materialRows = product =>
  product.materials.map(m => ({ role: m.role, nameEn: m.nameEn, nameCn: m.nameCn, specEn: m.specEn, sort: m.sort }));
const optionRows = product =>
  product.options.map(o => ({ kind: o.kind, code: o.code, nameEn: o.nameEn, nameCn: o.nameCn, isDefault: o.isDefault, sort: o.sort }));

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {(message: string) => void} log
 * @returns {Promise<{ applied: number; current: number; kept: string[] }>}
 */
export async function applyCatalog2026(db, log = () => {}) {
  const changes = JSON.parse(readFileSync(CHANGES, 'utf8'));
  const result = { applied: 0, current: 0, kept: [] };
  const models = [...new Set([...changes.products.map(p => p.model), ...changes.variants.map(v => v.model), ...changes.variants.map(v => v.identity?.to.model ?? v.model)])];
  const products = await db.product.findMany({
    where: { model: { in: models }, deletedAt: null },
    include: { materials: { orderBy: { sort: 'asc' } }, options: { orderBy: { sort: 'asc' } }, aiProfile: true },
  });
  // 空库（全新部署，种子会直接写入新数据）或产品被删掉时无事可做
  if (!products.length) return result;
  const productByModel = new Map(products.map(p => [p.model, p]));
  const owner = await db.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });

  /** 一组字段：仍是旧值 → 改；已是新值 → 跳过；否则保留人工值。 */
  const decide = (label, current, group) => {
    if (!group) return 'none';
    if (matches(current, group.from)) return 'apply';
    if (matches(current, pick(group.to, Object.keys(group.from)))) {
      result.current += 1;
      return 'current';
    }
    result.kept.push(label);
    return 'kept';
  };

  for (const change of changes.variants) {
    const newSku = change.identity?.to.sku ?? change.sku;
    const lookup = sku => db.productVariant.findFirst({ where: { sku, deletedAt: null }, include: { product: { select: { model: true } } } });
    const variant = (await lookup(change.sku)) ?? (newSku !== change.sku ? await lookup(newSku) : null);
    if (!variant) continue;
    const current = {
      ...variant,
      model: variant.product.model,
      cbm: num(variant.cbm),
      grossWeightKg: num(variant.grossWeightKg),
    };

    const data = {};
    let identity = decide(`${variant.sku} 的型号 / 尺寸`, current, change.identity);
    let targetProduct = null;
    if (identity === 'apply') {
      const { model, ...fields } = change.identity.to;
      targetProduct = productByModel.get(model) ?? null;
      const taken = fields.sku !== variant.sku && (await db.productVariant.findUnique({ where: { sku: fields.sku }, select: { id: true } }));
      if (!targetProduct || taken) {
        result.kept.push(`${variant.sku} 的型号 / 尺寸（${!targetProduct ? `找不到型号 ${model}` : `${fields.sku} 已存在`}）`);
        identity = 'kept';
        targetProduct = null;
      } else {
        Object.assign(data, fields, { productId: targetProduct.id });
      }
    }
    const label = decide(`${variant.sku} 的中文规格名`, current, change.label);
    const packing = decide(`${variant.sku} 的包装 / CBM / 毛重`, current, change.packing);
    let review = decide(`${variant.sku} 的待核对说明`, current, change.review);
    // 待核对说明是按新尺寸 / 包装写的：这两组保留了人工值时不套用，免得说明与数据对不上
    if (review === 'apply' && (identity === 'kept' || packing === 'kept')) {
      review = 'kept';
      result.kept.push(`${variant.sku} 的待核对说明`);
    }
    if (label === 'apply') Object.assign(data, change.label.to);
    if (packing === 'apply') {
      const { packingRaw, cbm, grossWeightKg, cartonCount, cbmComputed, grossWeightRaw } = change.packing.to;
      Object.assign(data, { packingRaw, cbm, grossWeightKg, cartonCount, cbmComputed, grossWeightRaw });
    }
    if (review === 'apply') Object.assign(data, change.review.to);

    const missingPrices = [];
    for (const price of change.addPrices ?? []) {
      const key = {
        variantId: variant.id,
        priceListKey: price.priceListKey,
        currency: price.currency,
        incoterm: 'FOB',
        customerTier: 'ALL',
        minQty: 1,
      };
      const existing = await db.productPrice.findUnique({ where: { variantId_priceListKey_currency_incoterm_customerTier_minQty: key } });
      if (!existing && owner) missingPrices.push({ ...key, price });
    }
    if (!Object.keys(data).length && !missingPrices.length) continue;

    await db.$transaction(async tx => {
      if (Object.keys(data).length) await tx.productVariant.update({ where: { id: variant.id }, data });
      // 挂在该变体上的图片跟着变体走
      if (targetProduct) {
        await tx.productMedia.updateMany({ where: { variantId: variant.id }, data: { productId: targetProduct.id } });
      }
      if (packing === 'apply') {
        await tx.packingCarton.deleteMany({ where: { variantId: variant.id } });
        if (change.packing.to.cartons.length) {
          await tx.packingCarton.createMany({ data: change.packing.to.cartons.map(carton => ({ ...carton, variantId: variant.id })) });
        }
      }
      for (const { price, ...key } of missingPrices) {
        await tx.productPrice.create({
          data: {
            ...key,
            includesFreight: false,
            unitPrice: price.unitPrice,
            effectiveFrom: new Date(price.effectiveFrom),
            status: 'ACTIVE',
            createdBy: owner.id,
          },
        });
      }
    });
    result.applied += 1;
    const moved = data.sku && data.sku !== variant.sku ? ` → ${data.sku}` : '';
    const prices = missingPrices.length ? `，补 ${missingPrices.map(p => `${p.currency} ${p.price.unitPrice}`).join(' / ')}` : '';
    log(`图册校正：${variant.sku}${moved}${prices}`);
  }

  for (const change of changes.products) {
    const product = productByModel.get(change.model);
    if (!product) continue;
    const current = {
      materials: comparable(materialRows(product)),
      options: comparable(optionRows(product)),
      searchText: product.aiProfile?.searchText ?? null,
    };
    const updates = [];
    for (const field of ['materials', 'options', 'searchText']) {
      if (!change[field]) continue;
      const from = field === 'searchText' ? change[field].from : comparable(change[field].from);
      const to = field === 'searchText' ? change[field].to : comparable(change[field].to);
      if (current[field] === to) result.current += 1;
      else if (current[field] === from) updates.push(field);
      else result.kept.push(`${change.model} 的${field === 'materials' ? '材料' : field === 'options' ? '面料 / 颜色' : '检索文本'}`);
    }
    if (!updates.length) continue;
    await db.$transaction(async tx => {
      if (updates.includes('materials')) {
        await tx.productMaterial.deleteMany({ where: { productId: product.id } });
        await tx.productMaterial.createMany({ data: change.materials.to.map(row => ({ ...row, productId: product.id })) });
      }
      if (updates.includes('options')) {
        await tx.productOption.deleteMany({ where: { productId: product.id } });
        await tx.productOption.createMany({ data: change.options.to.map(row => ({ ...row, productId: product.id })) });
      }
      if (updates.includes('searchText')) {
        await tx.productAiProfile.update({ where: { productId: product.id }, data: { searchText: change.searchText.to } });
      }
    });
    result.applied += 1;
    log(`图册校正：${change.model} 更新${updates.map(f => (f === 'materials' ? '材料' : f === 'options' ? '面料' : '检索文本')).join('、')}`);
  }

  if (result.applied) log(`图册校正：完成，改正 ${result.applied} 处。`);
  if (result.kept.length) log(`图册校正：以下字段已被人工修改，保留现值未动：${result.kept.join('；')}`);
  return result;
}
