/**
 * Product OS 种子数据
 *
 * 数据来源：docs/product-os/source-extract.json
 *   （从「LVANJU 2026 报价表」与「2026 Compactor Sofa Product Catalog」抽取，
 *     28 个型号 / 58 个可报价变体）
 *
 * 业务规则（2026-09-22 确认）：
 *   - 报价为 FOB，不含关税与运费
 *   - MOQ 按渠道分档：线上 10 件 / 线下交谈 20 件
 *   - 规格 / 包装 / CBM / 毛重 / 价格一律以报价表为准
 *
 * 幂等：按 Product.model 与 ProductVariant.sku upsert，可重复执行。
 *
 * 运行：pnpm db:seed:products
 */
import { existsSync, readFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { parsePacking, parseGrossWeight, cbmNeedsReview } from '../lib/product-packing';

// 本机开发时读 .env；生产环境（Hostinger 等）没有 .env，环境变量由平台注入。
// 不要在这里用 `node --env-file=.env`：文件不存在时 node 会直接退出，导致静默失败。
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL：无法连接数据库。请在环境中配置后重试。');
  process.exit(1);
}

const db = new PrismaClient();

const PRICE_LIST_KEY = 'LVANJU-2026';
const PRICE_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');
const SEED_SOURCE = 'docs/product-os/source-extract.json';

/** 已确认的渠道 MOQ（业务规则，非文档数据）。 */
const MOQ_TIERS = [
  { channel: 'ONLINE', channelLabelCn: '线上', minQty: 10 },
  { channel: 'OFFLINE', channelLabelCn: '线下交谈', minQty: 20 },
] as const;

type RawVariant = {
  label?: string | null;
  labelCn?: string | null;
  dimensions?: number[] | null;
  secondaryDimensions?: number[] | null;
  bedSizeCm?: number[] | null;
  packingRaw?: string;
  cbm?: number;
  grossWeightKg?: number;
  grossWeightRaw?: string;
  grossWeightKgMissing?: boolean;
  catalogGrossWeightKg?: number;
  catalogGrossWeightKgMissing?: boolean;
  unitPriceUsd?: number;
  note?: string;
};

type RawProduct = {
  model: string;
  category: string;
  series?: string;
  lengthLabel?: string;
  isModular?: boolean;
  isSofaBed?: boolean;
  catalogLengthLabel?: string;
  catalogPresent?: boolean;
  materials?: {
    layers?: (string | null)[];
    cover?: string | null;
    catalogCn?: string;
    catalogEn?: string;
    conflict?: string;
  };
  variants: RawVariant[];
  colourCode?: string;
  colourName?: string;
  catalogSeatLabels?: string[];
  catalogPillowCount?: string;
  note?: string;
  conflict?: string;
  consistent?: boolean;
};

type RawData = {
  products: RawProduct[];
  categories: { code: string; nameEn: string; nameCn: string }[];
  series: { code: string; nameEn: string; nameCn?: string }[];
  conflicts?: { id: string; models: string[]; field: string; detail: string; status?: string }[];
};

/** 依据材料名称判定分层角色。 */
function materialRole(name: string): string {
  if (/frame|steel/i.test(name)) return 'FRAME';
  if (/foam|sponge/i.test(name)) return 'FOAM';
  if (/cotton|fiber|fibre|feather|filling|particle/i.test(name)) return 'FILLING';
  return 'OTHER';
}

function variantSku(model: string, dims: number[] | null | undefined, index: number): string {
  if (dims && dims.length >= 3) return `${model}-${dims[0]}x${dims[1]}x${dims[2]}`;
  return `${model}-V${index + 1}`;
}

function dimensionLabel(raw: RawProduct): string {
  return raw.lengthLabel || raw.catalogLengthLabel || '';
}

async function main() {
  const admin = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true } });
  const data = JSON.parse(readFileSync(SEED_SOURCE, 'utf8')) as RawData;

  const conflictByModel = new Map<string, string[]>();
  for (const conflict of data.conflicts ?? []) {
    if (conflict.status === 'OPEN' || conflict.status === 'BLOCKER') {
      for (const model of conflict.models) {
        conflictByModel.set(model, [...(conflictByModel.get(model) ?? []), `${conflict.id}: ${conflict.detail}`]);
      }
    }
  }

  // ── 分类与系列 ──────────────────────────────────────────
  let sort = 0;
  for (const category of data.categories) {
    await db.productCategory.upsert({
      where: { code: category.code },
      create: { code: category.code, nameEn: category.nameEn, nameCn: category.nameCn, sort: sort++ },
      update: { nameEn: category.nameEn, nameCn: category.nameCn },
    });
  }
  sort = 0;
  for (const series of data.series) {
    await db.productSeries.upsert({
      where: { code: series.code },
      create: {
        code: series.code,
        nameEn: series.nameEn,
        nameCn: series.nameCn ?? '',
        descriptionEn: '',
        descriptionCn: '',
        sort: sort++,
      },
      update: { nameEn: series.nameEn },
    });
  }

  const categories = new Map((await db.productCategory.findMany()).map(c => [c.code, c.id]));
  const seriesMap = new Map((await db.productSeries.findMany()).map(s => [s.code, s.id]));

  let variantTotal = 0;
  let cartonTotal = 0;
  let flaggedTotal = 0;

  for (const raw of data.products) {
    const categoryId = categories.get(raw.category);
    if (!categoryId) throw new Error(`未知分类：${raw.category}`);
    const seriesId = raw.series ? seriesMap.get(raw.series) ?? null : null;

    const product = await db.product.upsert({
      where: { model: raw.model },
      create: {
        model: raw.model,
        nameEn: `${raw.category === 'COMPRESSED_BED' ? 'Compressed Bed' : 'Compressed Sofa'} ${raw.model}`,
        nameCn: '',
        categoryId,
        seriesId,
        status: 'ACTIVE',
        lengthLabel: dimensionLabel(raw),
        isModular: raw.isModular ?? false,
        isSofaBed: raw.isSofaBed ?? false,
        leadTimeDays: 15,
        qaMonths: 12,
        descriptionEn: '',
        descriptionCn: '',
        createdBy: admin.id,
      },
      update: {
        categoryId,
        seriesId,
        lengthLabel: dimensionLabel(raw),
        isModular: raw.isModular ?? false,
        isSofaBed: raw.isSofaBed ?? false,
      },
    });

    // ── 材料（分层，报价表为权威值；图册中英文名作为补充）────
    await db.productMaterial.deleteMany({ where: { productId: product.id } });
    const materialRows: Prisma.ProductMaterialCreateManyInput[] = [];
    let materialSort = 0;
    for (const layer of raw.materials?.layers ?? []) {
      if (!layer) continue;
      materialRows.push({
        productId: product.id,
        role: materialRole(layer),
        nameEn: layer,
        nameCn: '',
        specEn: '',
        sort: materialSort++,
      });
    }
    if (raw.materials?.cover) {
      materialRows.push({
        productId: product.id,
        role: 'COVER',
        nameEn: raw.materials.cover,
        nameCn: '',
        specEn: '',
        sort: materialSort++,
      });
    }
    if (materialRows.length) await db.productMaterial.createMany({ data: materialRows });

    // ── 面料 / 颜色选项 ────────────────────────────────────
    await db.productOption.deleteMany({ where: { productId: product.id } });
    const optionRows: Prisma.ProductOptionCreateManyInput[] = [];
    if (raw.materials?.cover) {
      optionRows.push({ productId: product.id, kind: 'FABRIC', code: '', nameEn: raw.materials.cover, nameCn: '', isDefault: true, sort: 0 });
    }
    if (raw.colourCode || raw.colourName) {
      optionRows.push({
        productId: product.id,
        kind: 'COLOUR',
        code: raw.colourCode ?? '',
        nameEn: raw.colourName ?? raw.colourCode ?? '',
        nameCn: '',
        isDefault: true,
        sort: 1,
      });
    }
    if (optionRows.length) await db.productOption.createMany({ data: optionRows });

    // ── 渠道 MOQ（全公司统一规则）───────────────────────────
    for (const tier of MOQ_TIERS) {
      await db.productMoq.upsert({
        where: { productId_channel: { productId: product.id, channel: tier.channel } },
        create: {
          productId: product.id,
          channel: tier.channel,
          channelLabelCn: tier.channelLabelCn,
          minQty: tier.minQty,
          note: '业务确认 2026-09-22',
        },
        update: { minQty: tier.minQty, channelLabelCn: tier.channelLabelCn },
      });
    }

    // ── 变体 + 包装 + 价格 ─────────────────────────────────
    const seen = new Set<string>();
    for (const [index, variant] of raw.variants.entries()) {
      const dims = variant.dimensions ?? null;
      const sku = variantSku(raw.model, dims, index);
      if (seen.has(sku)) throw new Error(`SKU 重复：${sku}`);
      seen.add(sku);

      const packing = parsePacking(variant.packingRaw);
      const weight = parseGrossWeight(variant.grossWeightRaw);
      const authoritativeCbm = variant.cbm ?? 0;
      // 毛重优先取报价表；报价表缺失时用图册补充值（并标注来源），不猜测。
      const usedCatalogWeight = variant.grossWeightKg === undefined && variant.catalogGrossWeightKg !== undefined;
      const grossWeight = variant.grossWeightKg ?? weight.total ?? variant.catalogGrossWeightKg ?? 0;

      const reviewNotes: string[] = [];
      if (variant.grossWeightKgMissing) reviewNotes.push('报价表缺毛重');
      if (variant.catalogGrossWeightKgMissing) reviewNotes.push('图册缺毛重');
      if (usedCatalogWeight) reviewNotes.push(`毛重取自图册（${variant.catalogGrossWeightKg}kg），报价表未列`);
      if (cbmNeedsReview(authoritativeCbm, packing.computedCbm)) {
        reviewNotes.push(
          `CBM 与包装不一致：报价表 ${authoritativeCbm}，按包装推导 ${packing.computedCbm}`,
        );
      }
      if (packing.notes.length) reviewNotes.push(...packing.notes);
      for (const conflict of conflictByModel.get(raw.model) ?? []) reviewNotes.push(conflict);
      if (variant.note) reviewNotes.push(variant.note);

      const secondary = variant.secondaryDimensions ?? null;
      const bedSize = variant.bedSizeCm ?? null;
      const needsReview = reviewNotes.length > 0;

      const savedVariant = await db.productVariant.upsert({
        where: { sku },
        create: {
          productId: product.id,
          sku,
          variantType: raw.isModular && variant.label && /SINGLE|OTTOMAN|FOOTSTOOL|1 SEAT/i.test(variant.label) ? 'MODULE' : 'CONFIGURATION',
          labelEn: variant.label ?? '',
          labelCn: variant.labelCn ?? '',
          lengthCm: dims?.[0] ?? null,
          widthCm: dims?.[1] ?? null,
          heightCm: dims?.[2] ?? null,
          secondaryLabelEn: secondary ? 'INTERNAL SPACE' : '',
          secondaryLabelCn: secondary ? '内空' : '',
          secondaryLengthCm: secondary?.[0] ?? null,
          secondaryWidthCm: secondary?.[1] ?? null,
          secondaryHeightCm: secondary?.[2] ?? null,
          bedSizeCm: bedSize ? bedSize.join('*') : '',
          packingRaw: variant.packingRaw ?? '',
          cartonCount: packing.cartonCount,
          cbm: new Prisma.Decimal(authoritativeCbm),
          cbmComputed: new Prisma.Decimal(packing.computedCbm),
          grossWeightKg: new Prisma.Decimal(grossWeight),
          grossWeightRaw: variant.grossWeightRaw ?? (variant.grossWeightKg ? String(variant.grossWeightKg) : ''),
          needsReview,
          reviewNote: reviewNotes.join('；'),
          status: 'ACTIVE',
          createdBy: admin.id,
        },
        update: {
          labelEn: variant.label ?? '',
          packingRaw: variant.packingRaw ?? '',
          cartonCount: packing.cartonCount,
          cbm: new Prisma.Decimal(authoritativeCbm),
          cbmComputed: new Prisma.Decimal(packing.computedCbm),
          grossWeightKg: new Prisma.Decimal(grossWeight),
          grossWeightRaw: variant.grossWeightRaw ?? '',
          needsReview,
          reviewNote: reviewNotes.join('；'),
        },
      });
      variantTotal += 1;
      if (needsReview) flaggedTotal += 1;

      await db.packingCarton.deleteMany({ where: { variantId: savedVariant.id } });
      if (packing.cartons.length) {
        await db.packingCarton.createMany({
          data: packing.cartons.map((carton, i) => ({
            variantId: savedVariant.id,
            label: carton.label,
            lengthCm: carton.lengthCm,
            widthCm: carton.widthCm,
            heightCm: carton.heightCm,
            cartonCount: carton.cartonCount,
            piecesPerCarton: carton.piecesPerCarton,
            grossWeightKg: weight.parts[i] !== undefined ? new Prisma.Decimal(weight.parts[i]) : null,
            sort: i,
          })),
        });
        cartonTotal += packing.cartons.length;
      }

      if (typeof variant.unitPriceUsd === 'number') {
        await db.productPrice.upsert({
          where: {
            variantId_priceListKey_currency_incoterm_customerTier_minQty: {
              variantId: savedVariant.id,
              priceListKey: PRICE_LIST_KEY,
              currency: 'USD',
              incoterm: 'FOB',
              customerTier: 'ALL',
              minQty: 1,
            },
          },
          create: {
            variantId: savedVariant.id,
            priceListKey: PRICE_LIST_KEY,
            currency: 'USD',
            incoterm: 'FOB',
            includesFreight: false,
            customerTier: 'ALL',
            minQty: 1,
            unitPrice: new Prisma.Decimal(variant.unitPriceUsd),
            effectiveFrom: PRICE_EFFECTIVE_FROM,
            status: 'ACTIVE',
            createdBy: admin.id,
          },
          update: {
            unitPrice: new Prisma.Decimal(variant.unitPriceUsd),
            incoterm: 'FOB',
          },
        });
      }
    }

    // ── AI 画像：只填可验证的检索文本，不编造卖点 / 推荐市场 ──
    const sizeText = raw.variants
      .map(v => (v.dimensions ? v.dimensions.join('x') : ''))
      .filter(Boolean)
      .join(' ');
    const searchText = [
      raw.model,
      raw.category === 'COMPRESSED_BED' ? 'compressed bed' : 'compressed sofa',
      dimensionLabel(raw),
      raw.materials?.layers?.join(' ') ?? '',
      raw.materials?.cover ?? '',
      sizeText,
      raw.lengthLabel ?? raw.catalogLengthLabel ?? '',
    ]
      .filter(Boolean)
      .join(' | ');

    await db.productAiProfile.upsert({
      where: { productId: product.id },
      create: {
        productId: product.id,
        sellingPointsJson: '[]',
        advantagesJson: '[]',
        useCasesJson: '[]',
        bestCustomerJson: '[]',
        recommendedMarketJson: '[]',
        keywordsJson: '[]',
        searchText,
        status: 'DRAFT',
      },
      update: { searchText },
    });
  }

  console.log(
    `Product OS seed 完成：${data.products.length} 个型号、${variantTotal} 个变体、` +
      `${cartonTotal} 条纸箱记录，其中 ${flaggedTotal} 个变体标记为待核对。`,
  );
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
