import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';

/**
 * 产品成本与毛利（仅管理员）
 *
 * 口径（业务确认 2026-09-23）：
 *   - 工厂成本与采购成本是**两种供货方式**，不是相加的分项；
 *     没做的产品就是外购的，所以每个尺寸通常只填其中一个。
 *   - 成本以人民币计；售价优先取中文报价表的人民币价，否则用美元价 × 汇率。
 *   - 成本**不含**国内运费与报关，因此这里是「生产毛利」，界面须如实标注。
 *
 * 安全：本文件所有导出函数都会校验管理员身份，成本字段绝不进入
 * 非管理员可见的产品查询结果（见 services/product-service.ts）。
 */

const ADMIN_ONLY = '仅管理员可以查看产品成本';

export function requireCostAdmin(user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, ADMIN_ONLY);
}

export const marginQuery = z.object({
  q: z.string().trim().max(60).default(''),
  cost: z.enum(['ALL', 'MISSING', 'FILLED']).default('ALL'),
  lowOnly: z.enum(['ALL', 'LOW']).default('ALL'),
});

const costInput = z
  .object({
    factoryCost: z.coerce.number().min(0).max(1e9).nullable().optional(),
    purchaseCost: z.coerce.number().min(0).max(1e9).nullable().optional(),
    note: z.string().trim().max(2000).default(''),
  })
  .refine(
    v => v.factoryCost !== undefined || v.purchaseCost !== undefined,
    '至少要填写工厂成本或采购成本中的一项',
  );

const rateInput = z.object({ rate: z.coerce.number().gt(0).max(100) });

/** 低于该毛利率视为需要关注。 */
export const LOW_MARGIN = 15;

export async function exchangeRate(): Promise<Prisma.Decimal> {
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { usdCnyRate: true } });
  return setting.usdCnyRate;
}

export async function getExchangeRate(user: Actor) {
  requireCostAdmin(user);
  const rate = await exchangeRate();
  return { rate: rate.toFixed(4), currencyPair: 'CNY/USD' };
}

export async function setExchangeRate(user: Actor, input: unknown) {
  requireCostAdmin(user);
  const { rate } = rateInput.parse(input);
  const saved = await db.setting.update({
    where: { id: 'system' },
    data: { usdCnyRate: new Prisma.Decimal(rate) },
    select: { usdCnyRate: true },
  });
  return { rate: saved.usdCnyRate.toFixed(4), currencyPair: 'CNY/USD' };
}

type Scenario = { cost: string; profit: string; margin: number } | null;

function scenario(priceCny: Prisma.Decimal | null, cost: Prisma.Decimal | null): Scenario {
  if (!priceCny || !cost) return null;
  const profit = priceCny.minus(cost);
  // 售价为 0 时毛利率无意义，返回 0 而不是 Infinity
  const margin = priceCny.isZero() ? 0 : Number(profit.div(priceCny).mul(100).toFixed(1));
  return { cost: cost.toFixed(2), profit: profit.toFixed(2), margin };
}

/**
 * 毛利总览：整库逐变体列出，并给出「自产 / 外购」两个场景。
 * 数据量小（几十到几百个变体），因此一次取回并在内存里排序，
 * 这样才能按毛利率排序（毛利率是计算值，数据库排不了）。
 */
export async function marginOverview(user: Actor, input: unknown = {}) {
  requireCostAdmin(user);
  const query = marginQuery.parse(input);
  const rate = await exchangeRate();

  const variants = await db.productVariant.findMany({
    where: {
      deletedAt: null,
      product: { deletedAt: null, ...(query.q ? { model: { contains: query.q } } : {}) },
    },
    select: {
      id: true,
      sku: true,
      labelCn: true,
      labelEn: true,
      lengthCm: true,
      widthCm: true,
      heightCm: true,
      cbm: true,
      product: {
        select: {
          id: true,
          model: true,
          nameCn: true,
          nameEn: true,
          category: { select: { nameCn: true, nameEn: true } },
        },
      },
      prices: { where: { status: 'ACTIVE' }, select: { unitPrice: true, currency: true } },
      costs: { where: { status: 'ACTIVE' }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
    },
    orderBy: [{ product: { model: 'asc' } }, { cbm: 'asc' }],
  });

  const rows = variants.map(variant => {
    const cheapest = (currency: string) => {
      const scoped = variant.prices.filter(p => p.currency === currency);
      if (!scoped.length) return null;
      return scoped.reduce((min, p) => (p.unitPrice.lessThan(min.unitPrice) ? p : min), scoped[0]).unitPrice;
    };
    const priceUsd = cheapest('USD');
    const priceCnyListed = cheapest('CNY');
    // 人民币售价优先取中文报价表；没有时用美元价按汇率折算
    const priceCny = priceCnyListed ?? (priceUsd ? priceUsd.mul(rate) : null);

    const cost = variant.costs[0] ?? null;
    const factory = scenario(priceCny, cost?.factoryCost ?? null);
    const purchase = scenario(priceCny, cost?.purchaseCost ?? null);
    const margins = [factory?.margin, purchase?.margin].filter((m): m is number => typeof m === 'number');

    return {
      variantId: variant.id,
      sku: variant.sku,
      label: variant.labelCn || variant.labelEn || '',
      size: [variant.lengthCm, variant.widthCm, variant.heightCm].every(Boolean)
        ? `${variant.lengthCm}×${variant.widthCm}×${variant.heightCm}`
        : '',
      cbm: variant.cbm.toFixed(4),
      productId: variant.product.id,
      model: variant.product.model,
      productName: variant.product.nameCn || variant.product.nameEn,
      categoryName: variant.product.category.nameCn || variant.product.category.nameEn,
      priceUsd: priceUsd ? priceUsd.toFixed(2) : null,
      priceCny: priceCny ? priceCny.toFixed(2) : null,
      priceCnyFromList: priceCnyListed !== null,
      factoryCost: cost?.factoryCost ? cost.factoryCost.toFixed(2) : null,
      purchaseCost: cost?.purchaseCost ? cost.purchaseCost.toFixed(2) : null,
      note: cost?.note ?? '',
      factory,
      purchase,
      hasCost: Boolean(cost && (cost.factoryCost || cost.purchaseCost)),
      // 两个场景里较差的那个，用于低毛利筛选与排序
      worstMargin: margins.length ? Math.min(...margins) : null,
      isLowMargin: margins.length ? Math.min(...margins) < LOW_MARGIN : false,
    };
  });

  const filtered = rows.filter(row => {
    if (query.cost === 'MISSING' && row.hasCost) return false;
    if (query.cost === 'FILLED' && !row.hasCost) return false;
    if (query.lowOnly === 'LOW' && !row.isLowMargin) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (a.hasCost !== b.hasCost) return a.hasCost ? 1 : -1; // 没填成本的排前面，提醒补
    if (a.worstMargin === null && b.worstMargin === null) return a.sku.localeCompare(b.sku);
    if (a.worstMargin === null) return 1;
    if (b.worstMargin === null) return -1;
    return a.worstMargin - b.worstMargin; // 毛利最低的排前面
  });

  return {
    query,
    rate: rate.toFixed(4),
    lowMarginThreshold: LOW_MARGIN,
    totals: {
      variants: rows.length,
      filled: rows.filter(r => r.hasCost).length,
      missing: rows.filter(r => !r.hasCost).length,
      lowMargin: rows.filter(r => r.isLowMargin).length,
    },
    rows: filtered,
  };
}

/** 产品详情用：单个型号各个尺寸的成本与毛利。 */
export async function productCostSummary(user: Actor, productId: string) {
  requireCostAdmin(user);
  const rate = await exchangeRate();
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      model: true,
      variants: {
        where: { deletedAt: null },
        orderBy: [{ cbm: 'asc' }],
        select: {
          id: true,
          sku: true,
          labelCn: true,
          labelEn: true,
          lengthCm: true,
          widthCm: true,
          heightCm: true,
          prices: { where: { status: 'ACTIVE' }, select: { unitPrice: true, currency: true } },
          costs: { where: { status: 'ACTIVE' }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
        },
      },
    },
  });
  if (!product) throw new HttpError(404, '产品不存在');

  return {
    productId: product.id,
    model: product.model,
    rate: rate.toFixed(4),
    lowMarginThreshold: LOW_MARGIN,
    variants: product.variants.map(variant => {
      const cheapest = (currency: string) => {
        const scoped = variant.prices.filter(p => p.currency === currency);
        if (!scoped.length) return null;
        return scoped.reduce((min, p) => (p.unitPrice.lessThan(min.unitPrice) ? p : min), scoped[0]).unitPrice;
      };
      const priceUsd = cheapest('USD');
      const priceCnyListed = cheapest('CNY');
      const priceCny = priceCnyListed ?? (priceUsd ? priceUsd.mul(rate) : null);
      const cost = variant.costs[0] ?? null;
      return {
        variantId: variant.id,
        sku: variant.sku,
        label: variant.labelCn || variant.labelEn || '',
        size: [variant.lengthCm, variant.widthCm, variant.heightCm].every(Boolean)
          ? `${variant.lengthCm}×${variant.widthCm}×${variant.heightCm}`
          : '',
        priceUsd: priceUsd ? priceUsd.toFixed(2) : null,
        priceCny: priceCny ? priceCny.toFixed(2) : null,
        priceCnyFromList: priceCnyListed !== null,
        factoryCost: cost?.factoryCost ? cost.factoryCost.toFixed(2) : null,
        purchaseCost: cost?.purchaseCost ? cost.purchaseCost.toFixed(2) : null,
        note: cost?.note ?? '',
        factory: scenario(priceCny, cost?.factoryCost ?? null),
        purchase: scenario(priceCny, cost?.purchaseCost ?? null),
      };
    }),
  };
}

/** 录入或更新某个尺寸变体的成本（仅管理员）。 */
export async function upsertCost(user: Actor, variantId: string, input: unknown) {
  requireCostAdmin(user);
  const v = costInput.parse(input);

  const variant = await db.productVariant.findFirst({
    where: { id: variantId, deletedAt: null },
    select: { id: true, sku: true },
  });
  if (!variant) throw new HttpError(404, '尺寸变体不存在');

  const data = {
    factoryCost: v.factoryCost === undefined ? undefined : v.factoryCost === null ? null : new Prisma.Decimal(v.factoryCost),
    purchaseCost: v.purchaseCost === undefined ? undefined : v.purchaseCost === null ? null : new Prisma.Decimal(v.purchaseCost),
    note: v.note,
  };

  const existing = await db.productCost.findFirst({
    where: { variantId, status: 'ACTIVE' },
    orderBy: { effectiveFrom: 'desc' },
    select: { id: true },
  });

  const saved = existing
    ? await db.productCost.update({ where: { id: existing.id }, data })
    : await db.productCost.create({ data: { ...data, variantId, createdBy: user.id } });

  return {
    variantId: saved.variantId,
    sku: variant.sku,
    factoryCost: saved.factoryCost ? saved.factoryCost.toFixed(2) : null,
    purchaseCost: saved.purchaseCost ? saved.purchaseCost.toFixed(2) : null,
    note: saved.note,
  };
}
