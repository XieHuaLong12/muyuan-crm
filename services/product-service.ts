import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { unitsPer40HQ } from '@/lib/product-packing';

/**
 * Product OS 服务层
 *
 * 约定（见 PROJECT_RULES.md）：
 *   - 所有入参在本文件内用 Zod 解析
 *   - 业务规则集中在 services，路由保持极薄
 *   - 读操作对所有登录用户开放；写操作仅 ADMIN
 *   - 派生值（40HQ 装载量、起价）在读时计算，不落库
 */

export const CHANNELS = ['ONLINE', 'OFFLINE', 'ALIBABA', 'WEBSITE', 'EXHIBITION'] as const;

export const productListQuery = z.object({
  q: z.string().trim().max(100).default(''),
  category: z.string().trim().max(40).default(''),
  series: z.string().trim().max(40).default(''),
  status: z.enum(['ALL', 'ACTIVE', 'DRAFT', 'ARCHIVED']).default('ACTIVE'),
  review: z.enum(['ALL', 'NEEDS_REVIEW']).default('ALL'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

const variantPatch = z.object({
  labelEn: z.string().trim().max(120).optional(),
  labelCn: z.string().trim().max(120).optional(),
  lengthCm: z.coerce.number().int().min(1).max(2000).nullable().optional(),
  widthCm: z.coerce.number().int().min(1).max(2000).nullable().optional(),
  heightCm: z.coerce.number().int().min(1).max(2000).nullable().optional(),
  packingRaw: z.string().trim().max(300).optional(),
  cartonCount: z.coerce.number().int().min(1).max(50).optional(),
  cbm: z.coerce.number().min(0).max(50).optional(),
  grossWeightKg: z.coerce.number().min(0).max(5000).optional(),
  reviewNote: z.string().trim().max(2000).optional(),
  needsReview: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

const priceQuery = z.object({
  qty: z.coerce.number().int().min(1).max(1000000).default(1),
  currency: z.enum(['USD', 'CNY', 'EUR']).default('USD'),
  incoterm: z.enum(['FOB', 'EXW', 'CIF', 'DDP']).default('FOB'),
  tier: z.enum(['ALL', 'WHOLESALE', 'IMPORTER', 'DISTRIBUTOR', 'BRAND']).default('ALL'),
  channel: z.enum(CHANNELS).default('ONLINE'),
});

const PAGE_SIZE = 24;

function requireAdmin(user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '需要管理员权限');
}

const variantSummary = {
  id: true,
  sku: true,
  variantType: true,
  labelEn: true,
  labelCn: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  secondaryLabelCn: true,
  secondaryLengthCm: true,
  secondaryWidthCm: true,
  secondaryHeightCm: true,
  bedSizeCm: true,
  packingRaw: true,
  cartonCount: true,
  cbm: true,
  cbmComputed: true,
  grossWeightKg: true,
  grossWeightRaw: true,
  needsReview: true,
  reviewNote: true,
  status: true,
} as const;

/** 单变体起价（同币种同术语下的最低有效价）。 */
function lowestPrice(prices: { unitPrice: Prisma.Decimal; currency: string; incoterm: string }[]) {
  if (!prices.length) return null;
  const lowest = prices.reduce((min, p) => (p.unitPrice.lessThan(min.unitPrice) ? p : min), prices[0]);
  return { amount: lowest.unitPrice.toFixed(2), currency: lowest.currency, incoterm: lowest.incoterm };
}

export async function productList(user: Actor, input: unknown = {}) {
  const query = productListQuery.parse(input);
  void user;

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(query.status === 'ALL' ? {} : { status: query.status }),
    ...(query.category ? { category: { code: query.category } } : {}),
    ...(query.series ? { series: { code: query.series } } : {}),
    ...(query.q
      ? {
          OR: [
            { model: { contains: query.q } },
            { nameEn: { contains: query.q } },
            { variants: { some: { sku: { contains: query.q } } } },
          ],
        }
      : {}),
    ...(query.review === 'NEEDS_REVIEW' ? { variants: { some: { needsReview: true, deletedAt: null } } } : {}),
  };

  const [rows, total, categories, seriesList, reviewCount, libraryTotal] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        category: { select: { code: true, nameCn: true, nameEn: true } },
        series: { select: { code: true, nameEn: true } },
        variants: {
          where: { deletedAt: null },
          select: { id: true, sku: true, cbm: true, needsReview: true, prices: { where: { status: 'ACTIVE' }, select: { unitPrice: true, currency: true, incoterm: true } } },
        },
        media: { where: { role: 'HERO' }, select: { storageKey: true }, orderBy: { sort: 'asc' }, take: 1 },
      },
      orderBy: [{ category: { sort: 'asc' } }, { model: 'asc' }],
      skip: (query.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.product.count({ where }),
    db.productCategory.findMany({ orderBy: { sort: 'asc' } }),
    db.productSeries.findMany({ orderBy: { sort: 'asc' } }),
    db.productVariant.count({ where: { needsReview: true, deletedAt: null } }),
    // 未经过滤的总数，用于区分「产品库为空」与「筛选无结果」
    db.product.count({ where: { deletedAt: null } }),
  ]);

  return {
    query,
    pageSize: PAGE_SIZE,
    total,
    libraryTotal,
    reviewCount,
    categories: categories.map(c => ({ code: c.code, nameCn: c.nameCn, nameEn: c.nameEn })),
    series: seriesList.map(s => ({ code: s.code, nameEn: s.nameEn })),
    products: rows.map(p => {
      const prices = p.variants.flatMap(v => v.prices);
      const cbmValues = p.variants.map(v => Number(v.cbm)).filter(v => v > 0);
      return {
        id: p.id,
        model: p.model,
        nameEn: p.nameEn,
        categoryCode: p.category.code,
        categoryName: p.category.nameCn || p.category.nameEn,
        seriesName: p.series?.nameEn ?? '',
        status: p.status,
        lengthLabel: p.lengthLabel,
        isModular: p.isModular,
        isSofaBed: p.isSofaBed,
        variantCount: p.variants.length,
        reviewCount: p.variants.filter(v => v.needsReview).length,
        minCbm: cbmValues.length ? Math.min(...cbmValues) : null,
        minUnitsPer40HQ: cbmValues.length ? unitsPer40HQ(Math.max(...cbmValues)) : null,
        startingPrice: lowestPrice(prices),
        image: p.media[0]?.storageKey ?? null,
      };
    }),
  };
}

export async function productDetail(user: Actor, id: string) {
  void user;
  const product = await db.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: true,
      series: true,
      variants: {
        where: { deletedAt: null },
        select: {
          ...variantSummary,
          cartons: { orderBy: { sort: 'asc' } },
          prices: { where: { status: 'ACTIVE' }, orderBy: { minQty: 'asc' } },
        },
        orderBy: [{ cbm: 'asc' }, { sku: 'asc' }],
      },
      materials: { orderBy: { sort: 'asc' } },
      options: { orderBy: { sort: 'asc' } },
      moqs: { orderBy: { minQty: 'asc' } },
      media: { orderBy: { sort: 'asc' } },
      aiProfile: true,
    },
  });
  if (!product) throw new HttpError(404, '产品不存在');

  return {
    id: product.id,
    model: product.model,
    nameEn: product.nameEn,
    nameCn: product.nameCn,
    status: product.status,
    lengthLabel: product.lengthLabel,
    category: { code: product.category.code, nameCn: product.category.nameCn, nameEn: product.category.nameEn },
    series: product.series ? { code: product.series.code, nameEn: product.series.nameEn } : null,
    isModular: product.isModular,
    isSofaBed: product.isSofaBed,
    leadTimeDays: product.leadTimeDays,
    qaMonths: product.qaMonths,
    variants: product.variants.map(v => ({
      ...v,
      cbm: v.cbm.toFixed(4),
      cbmComputed: v.cbmComputed?.toFixed(4) ?? null,
      grossWeightKg: v.grossWeightKg.toFixed(2),
      unitsPer40HQ: unitsPer40HQ(Number(v.cbm)),
      cartons: v.cartons.map(c => ({
        ...c,
        grossWeightKg: c.grossWeightKg?.toFixed(2) ?? null,
      })),
      prices: v.prices.map(p => ({
        id: p.id,
        priceListKey: p.priceListKey,
        currency: p.currency,
        incoterm: p.incoterm,
        includesFreight: p.includesFreight,
        customerTier: p.customerTier,
        minQty: p.minQty,
        maxQty: p.maxQty,
        unitPrice: p.unitPrice.toFixed(2),
        effectiveFrom: p.effectiveFrom.toISOString(),
      })),
      startingPrice: lowestPrice(v.prices),
    })),
    materials: product.materials.map(m => ({ id: m.id, role: m.role, nameEn: m.nameEn, nameCn: m.nameCn, specEn: m.specEn })),
    options: product.options.map(o => ({ id: o.id, kind: o.kind, code: o.code, nameEn: o.nameEn, nameCn: o.nameCn, isDefault: o.isDefault })),
    moqs: product.moqs.map(m => ({ channel: m.channel, channelLabelCn: m.channelLabelCn, minQty: m.minQty })),
    media: product.media.map(m => ({ id: m.id, role: m.role, fileName: m.fileName, storageKey: m.storageKey })),
    aiProfile: product.aiProfile
      ? {
          status: product.aiProfile.status,
          sellingPoints: parseJsonArray(product.aiProfile.sellingPointsJson),
          advantages: parseJsonArray(product.aiProfile.advantagesJson),
          useCases: parseJsonArray(product.aiProfile.useCasesJson),
          bestCustomer: parseJsonArray(product.aiProfile.bestCustomerJson),
          recommendedMarket: parseJsonArray(product.aiProfile.recommendedMarketJson),
          keywords: parseJsonArray(product.aiProfile.keywordsJson),
          searchText: product.aiProfile.searchText,
        }
      : null,
  };
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 定价解析：按数量 / 币种 / 贸易术语 / 客户等级 / 渠道返回唯一价格 + MOQ 校验。
 * 这是 AI 报价与订单定价的唯一入口，避免口径分叉。
 */
export async function resolveQuotePrice(user: Actor, productId: string, input: unknown = {}) {
  void user;
  const query = priceQuery.parse(input);
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      model: true,
      moqs: { where: { channel: query.channel }, select: { minQty: true, channelLabelCn: true } },
      variants: {
        where: { deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          sku: true,
          labelEn: true,
          prices: {
            where: {
              status: 'ACTIVE',
              currency: query.currency,
              incoterm: query.incoterm,
              minQty: { lte: query.qty },
              AND: [{ OR: [{ customerTier: query.tier }, { customerTier: 'ALL' }] }],
            },
            orderBy: { minQty: 'desc' },
          },
        },
      },
    },
  });
  if (!product) throw new HttpError(404, '产品不存在');

  const moq = product.moqs[0]?.minQty ?? null;
  const moqCheck = moq === null
    ? { ok: false as const, reason: '该渠道未配置起订量' }
    : query.qty < moq
      ? { ok: false as const, reason: `低于该渠道起订量（${moq} 件）`, required: moq }
      : { ok: true as const, required: moq };

  const offers = product.variants
    .map(v => {
      const price = v.prices[0];
      if (!price) return null;
      return {
        variantId: v.id,
        sku: v.sku,
        labelEn: v.labelEn,
        unitPrice: price.unitPrice.toFixed(2),
        currency: price.currency,
        incoterm: price.incoterm,
        priceListKey: price.priceListKey,
        minQty: price.minQty,
        totalAmount: price.unitPrice.mul(query.qty).toFixed(2),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice));

  return {
    productId: product.id,
    model: product.model,
    query,
    moqCheck,
    offers,
    note: offers.length ? '价格为 FOB，不含关税与运费' : '该数量/币种/术语下没有匹配价格，请人工核实',
  };
}

export async function productMoq(user: Actor, productId: string, channel: string) {
  void user;
  const parsed = z.enum(CHANNELS).parse(channel);
  const moq = await db.productMoq.findUnique({
    where: { productId_channel: { productId, channel: parsed } },
    select: { channel: true, channelLabelCn: true, minQty: true },
  });
  return { productId, channel: parsed, moq };
}

/** 修正变体数据（用于处理 needsReview 标记的行）。 */
export async function updateVariant(user: Actor, variantId: string, input: unknown) {
  requireAdmin(user);
  const v = variantPatch.parse(input);
  const existing = await db.productVariant.findFirst({ where: { id: variantId, deletedAt: null } });
  if (!existing) throw new HttpError(404, '变体不存在');

  return db.productVariant.update({
    where: { id: variantId },
    data: {
      ...v,
      cbm: v.cbm === undefined ? undefined : new Prisma.Decimal(v.cbm),
      grossWeightKg: v.grossWeightKg === undefined ? undefined : new Prisma.Decimal(v.grossWeightKg),
    },
    select: variantSummary,
  });
}
