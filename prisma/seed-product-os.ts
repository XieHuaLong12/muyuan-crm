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
import { existsSync, readFileSync, statSync } from 'node:fs';
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
const PRICE_LIST_KEY_CN = 'LVANJU-2026-CN';
const PRICE_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');
const SEED_SOURCE = 'docs/product-os/source-extract.json';
const SEED_SOURCE_CN = 'docs/product-os/source-extract-cn.json';

/** 已确认的渠道 MOQ（业务规则，非文档数据）。 */
/** 分类 code → 英文名，用于生成产品英文名。 */
const CATEGORY_EN: Record<string, string> = {
  SERIES_Y_SOFA: 'Compressed Sofa',
  SERIES_D_CHAIR: 'Compressed Chair',
  SERIES_C_BED: 'Compressed Bed',
  SERIES_M_MATTRESS: 'Compressed Mattress',
};

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

/** 中文报价表（绿安居·压缩家具系列2026年报价）。 */
type CnVariant = [number[] | null, string, number, number | null, number | null];

type RawCnProduct = {
  model: string;
  nameCn?: string;
  nameEn?: string;
  newInCn?: boolean;
  materialsCn?: { layers?: string[]; cover?: string };
  variants: CnVariant[];
  /** 两份报价表中该型号编号整体对调，中文变体数据不可按序号套用。 */
  swappedWith?: string;
  note?: string;
};

type RawCnData = {
  products: RawCnProduct[];
  categories: {
    code: string;
    level: number;
    nameCn: string;
    nameEn: string;
    parent: string | null;
    codePrefix?: string;
    empty?: boolean;
  }[];
  modelCategory: Record<string, string>;
  conflicts?: { id: string; models: string[]; detail: string }[];
};

/** 依据材料名称判定分层角色（支持英文与中文写法）。 */
function materialRole(name: string): string {
  if (/frame|steel|钢架|钢骨/i.test(name)) return 'FRAME';
  if (/foam|sponge|海绵/i.test(name)) return 'FOAM';
  if (/cotton|fiber|fibre|feather|filling|particle|绵|棉|丝|弹簧|记忆/i.test(name)) return 'FILLING';
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
  const dataCn = JSON.parse(readFileSync(SEED_SOURCE_CN, 'utf8')) as RawCnData;
  const cnByModel = new Map(dataCn.products.map(p => [p.model, p]));

  const conflictByModel = new Map<string, string[]>();
  for (const conflict of data.conflicts ?? []) {
    if (conflict.status === 'OPEN' || conflict.status === 'BLOCKER') {
      for (const model of conflict.models) {
        conflictByModel.set(model, [...(conflictByModel.get(model) ?? []), `${conflict.id}: ${conflict.detail}`]);
      }
    }
  }
  // 中文报价表与英文报价表的差异：只登记，不自动改写英文表的数值。
  const cnConflictByModel = new Map<string, string[]>();
  for (const conflict of dataCn.conflicts ?? []) {
    for (const model of conflict.models) {
      cnConflictByModel.set(model, [...(cnConflictByModel.get(model) ?? []), `${conflict.id}: ${conflict.detail}`]);
    }
  }

  // ── 分类树（两层）────────────────────────────────────────
  // 第一层级：压缩家具系列 / 智能床垫系列
  // 第二层级：Y 压缩沙发 · D 压缩单人椅 · C 压缩床 · M 压缩床垫
  // 注意：D 系列是「压缩单人椅」，不是沙发 —— 旧的两级分类把它错归进了沙发。
  let sort = 0;
  for (const category of dataCn.categories.filter(c => !c.parent)) {
    await db.productCategory.upsert({
      where: { code: category.code },
      create: { code: category.code, nameEn: category.nameEn, nameCn: category.nameCn, level: 1, codePrefix: '', sort: sort++ },
      update: { nameEn: category.nameEn, nameCn: category.nameCn, level: 1, codePrefix: '', parentId: null },
    });
  }
  const rootIds = new Map((await db.productCategory.findMany()).map(c => [c.code, c.id]));
  sort = 0;
  for (const category of dataCn.categories.filter(c => c.parent)) {
    const parentId = rootIds.get(category.parent as string) ?? null;
    await db.productCategory.upsert({
      where: { code: category.code },
      create: { code: category.code, nameEn: category.nameEn, nameCn: category.nameCn, level: 2, codePrefix: category.codePrefix ?? '', sort: sort++, parentId },
      update: { nameEn: category.nameEn, nameCn: category.nameCn, level: 2, codePrefix: category.codePrefix ?? '', parentId },
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
  const categoryNames = new Map((await db.productCategory.findMany()).map(c => [c.code, c.nameCn]));
  const seriesMap = new Map((await db.productSeries.findMany()).map(s => [s.code, s.id]));

  let variantTotal = 0;
  let cartonTotal = 0;
  let flaggedTotal = 0;
  const missingImages: string[] = [];

  // M 系列只存在于中文报价表，合并进同一遍处理。
  const products: { raw: RawProduct; cn: RawCnProduct | undefined; model: string }[] = [
    ...data.products.map(raw => ({ raw, cn: cnByModel.get(raw.model), model: raw.model })),
    ...dataCn.products
      .filter(p => p.newInCn)
      .map(cn => ({
        model: cn.model,
        cn,
        raw: {
          model: cn.model,
          category: 'COMPRESSED_MATTRESS',
          series: 'WARM_HOME',
          materials: { layers: [], cover: null },
          variants: [],
        } as RawProduct,
      })),
  ];

  for (const { raw, cn } of products) {
    const prefix = raw.model.charAt(0);
    const categoryCode = dataCn.modelCategory[prefix];
    const categoryId = categoryCode ? categories.get(categoryCode) : undefined;
    if (!categoryId) throw new Error(`未知分类：型号 ${raw.model}（前缀 ${prefix}）`);
    const seriesId = raw.series ? seriesMap.get(raw.series) ?? null : null;
    const cnName = cn?.nameCn ?? `${categoryNames.get(categoryCode) ?? ''} ${raw.model}`.trim();
    const enName = cn?.nameEn ?? `${CATEGORY_EN[categoryCode] ?? 'Product'} ${raw.model}`;

    const product = await db.product.upsert({
      where: { model: raw.model },
      create: {
        model: raw.model,
        nameEn: enName,
        nameCn: cnName,
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
        nameEn: enName,
        nameCn: cnName,
        lengthLabel: dimensionLabel(raw),
        isModular: raw.isModular ?? false,
        isSofaBed: raw.isSofaBed ?? false,
      },
    });

    // Y-615 / Y-616 在两份报价表中编号整体对调，中文变体与材料数据不可套用。
    const cnUsable = cn && !cn.swappedWith ? cn : undefined;

    // ── 材料（分层：英文取自英文报价表，中文取自中文报价表）────
    await db.productMaterial.deleteMany({ where: { productId: product.id } });
    const cnMaterials = cnUsable?.materialsCn;
    const materialRows: Prisma.ProductMaterialCreateManyInput[] = [];
    let materialSort = 0;
    const layerCount = Math.max(raw.materials?.layers?.length ?? 0, cnMaterials?.layers?.length ?? 0);
    for (let i = 0; i < layerCount; i += 1) {
      const en = raw.materials?.layers?.[i] ?? '';
      const cnText = cnMaterials?.layers?.[i] ?? '';
      if (!en && !cnText) continue;
      materialRows.push({
        productId: product.id,
        role: materialRole(en || cnText),
        nameEn: en,
        nameCn: cnText,
        specEn: '',
        sort: materialSort++,
      });
    }
    const coverEn = raw.materials?.cover ?? '';
    const coverCn = cnMaterials?.cover ?? '';
    if (coverEn || coverCn) {
      materialRows.push({
        productId: product.id,
        role: 'COVER',
        nameEn: coverEn,
        nameCn: coverCn,
        specEn: '',
        sort: materialSort++,
      });
    }
    if (materialRows.length) await db.productMaterial.createMany({ data: materialRows });

    // ── 面料 / 颜色选项 ────────────────────────────────────
    await db.productOption.deleteMany({ where: { productId: product.id } });
    const optionRows: Prisma.ProductOptionCreateManyInput[] = [];
    if (raw.materials?.cover || cnMaterials?.cover) {
      optionRows.push({
        productId: product.id,
        kind: 'FABRIC',
        code: '',
        nameEn: raw.materials?.cover ?? '',
        nameCn: cnMaterials?.cover ?? '',
        isDefault: true,
        sort: 0,
      });
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

    // ── 产品主图 ───────────────────────────────────────────
    // 图片来自产品图册（每页印有 Model 号，已逐页核对），
    // 缺图的型号不猜测、不占位，由界面提示补图。
    const imageFile = `public/products/${raw.model}.jpg`;
    if (existsSync(imageFile)) {
      const storageKey = `products/${raw.model}.jpg`;
      await db.productMedia.upsert({
        where: { storageKey },
        create: {
          productId: product.id,
          role: 'HERO',
          storageKey,
          mimeType: 'image/jpeg',
          fileName: `${raw.model}.jpg`,
          size: statSync(imageFile).size,
          sort: 0,
          createdBy: admin.id,
        },
        update: { productId: product.id, size: statSync(imageFile).size },
      });
    } else {
      missingImages.push(raw.model);
    }

    // ── 变体 + 包装 + 价格 ─────────────────────────────────
    // 英文报价表为主，中文报价表按序号补充人民币价格与中文差异登记。
    // M 系列只有中文报价表，此时英文侧为空，直接采用中文值。
    const seen = new Set<string>();
    const dimList: string[] = [];
    const variantCount = Math.max(raw.variants.length, cnUsable?.variants.length ?? 0);
    for (let index = 0; index < variantCount; index += 1) {
      const variant = raw.variants[index] ?? null;
      const cnVariant = cnUsable?.variants[index] ?? null;
      const dims = variant?.dimensions ?? cnVariant?.[0] ?? null;
      const packingRaw = variant?.packingRaw ?? cnVariant?.[1] ?? '';
      const sku = variantSku(raw.model, dims, index);
      if (seen.has(sku)) throw new Error(`SKU 重复：${sku}`);
      seen.add(sku);

      const packing = parsePacking(packingRaw);
      const weight = parseGrossWeight(variant?.grossWeightRaw);
      const authoritativeCbm = variant?.cbm ?? cnVariant?.[2] ?? 0;
      const priceUsd = variant?.unitPriceUsd;
      const priceCny = cnVariant?.[4] ?? undefined;
      // 毛重优先取报价表；报价表缺失时用图册或中文表补充值（并标注来源），不猜测。
      const grossWeight =
        variant?.grossWeightKg ?? cnVariant?.[3] ?? weight.total ?? variant?.catalogGrossWeightKg ?? 0;

      const reviewNotes: string[] = [];
      if (variant?.grossWeightKgMissing && cnVariant?.[3] == null) reviewNotes.push('中英文报价表均缺毛重');
      if (variant?.catalogGrossWeightKgMissing) reviewNotes.push('图册缺毛重');
      if (variant?.grossWeightKg === undefined && cnVariant?.[3] != null) {
        reviewNotes.push(`毛重取自中文报价表（${cnVariant[3]}kg）`);
      }
      if (cbmNeedsReview(authoritativeCbm, packing.computedCbm)) {
        reviewNotes.push(
          `CBM 与包装不一致：采用 ${authoritativeCbm}，按包装推导 ${packing.computedCbm}`,
        );
      }
      if (packing.notes.length) reviewNotes.push(...packing.notes);
      for (const conflict of conflictByModel.get(raw.model) ?? []) reviewNotes.push(conflict);
      for (const conflict of cnConflictByModel.get(raw.model) ?? []) reviewNotes.push(conflict);
      if (variant?.note) reviewNotes.push(variant.note);

      if (dims && dims.length >= 3) dimList.push(dims.join('x'));
      const secondary = variant?.secondaryDimensions ?? null;
      const bedSize = variant?.bedSizeCm ?? null;
      const needsReview = reviewNotes.length > 0;

      const savedVariant = await db.productVariant.upsert({
        where: { sku },
        create: {
          productId: product.id,
          sku,
          variantType: raw.isModular && variant?.label && /SINGLE|OTTOMAN|FOOTSTOOL|1 SEAT/i.test(variant.label) ? 'MODULE' : 'CONFIGURATION',
          labelEn: variant?.label ?? '',
          labelCn: variant?.labelCn ?? '',
          lengthCm: dims?.[0] ?? null,
          widthCm: dims?.[1] ?? null,
          heightCm: dims?.[2] ?? null,
          secondaryLabelEn: secondary ? 'INTERNAL SPACE' : '',
          secondaryLabelCn: secondary ? '内空' : '',
          secondaryLengthCm: secondary?.[0] ?? null,
          secondaryWidthCm: secondary?.[1] ?? null,
          secondaryHeightCm: secondary?.[2] ?? null,
          bedSizeCm: bedSize ? bedSize.join('*') : '',
          packingRaw,
          cartonCount: packing.cartonCount,
          cbm: new Prisma.Decimal(authoritativeCbm),
          cbmComputed: new Prisma.Decimal(packing.computedCbm),
          grossWeightKg: new Prisma.Decimal(grossWeight),
          grossWeightRaw: variant?.grossWeightRaw ?? (variant?.grossWeightKg ? String(variant.grossWeightKg) : ''),
          needsReview,
          reviewNote: reviewNotes.join('；'),
          status: 'ACTIVE',
          createdBy: admin.id,
        },
        update: {
          labelEn: variant?.label ?? '',
          packingRaw,
          cartonCount: packing.cartonCount,
          cbm: new Prisma.Decimal(authoritativeCbm),
          cbmComputed: new Prisma.Decimal(packing.computedCbm),
          grossWeightKg: new Prisma.Decimal(grossWeight),
          grossWeightRaw: variant?.grossWeightRaw ?? '',
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

      // 人民币价格（中文报价表）与美元价格（英文报价表）并存，界面按语言展示。
      for (const offer of [
        { priceListKey: PRICE_LIST_KEY, currency: 'USD', amount: priceUsd },
        { priceListKey: PRICE_LIST_KEY_CN, currency: 'CNY', amount: priceCny },
      ]) {
        if (typeof offer.amount !== 'number') continue;
        await db.productPrice.upsert({
          where: {
            variantId_priceListKey_currency_incoterm_customerTier_minQty: {
              variantId: savedVariant.id,
              priceListKey: offer.priceListKey,
              currency: offer.currency,
              incoterm: 'FOB',
              customerTier: 'ALL',
              minQty: 1,
            },
          },
          create: {
            variantId: savedVariant.id,
            priceListKey: offer.priceListKey,
            currency: offer.currency,
            incoterm: 'FOB',
            includesFreight: false,
            customerTier: 'ALL',
            minQty: 1,
            unitPrice: new Prisma.Decimal(offer.amount),
            effectiveFrom: PRICE_EFFECTIVE_FROM,
            status: 'ACTIVE',
            createdBy: admin.id,
          },
          update: { unitPrice: new Prisma.Decimal(offer.amount), incoterm: 'FOB' },
        });
      }
    }

    // ── AI 画像：只填可验证的检索文本，不编造卖点 / 推荐市场 ──
    const sizeText = dimList.join(' ');
    const searchText = [
      raw.model,
      enName,
      cnName,
      dimensionLabel(raw),
      raw.materials?.layers?.join(' ') ?? '',
      raw.materials?.cover ?? '',
      cn?.materialsCn?.layers?.join(' ') ?? '',
      cn?.materialsCn?.cover ?? '',
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

  // 旧的两级分类已废弃（D 系列被错误归入沙发）。仅在产品已全部迁走后删除，避免留下悬挂引用。
  await db.productCategory.deleteMany({
    where: { code: { in: ['COMPRESSED_SOFA', 'COMPRESSED_BED'] }, products: { none: {} } },
  });

  const categoryTotal = await db.productCategory.count();
  const cnyPrices = await db.productPrice.count({ where: { currency: 'CNY' } });
  console.log(
    `Product OS seed 完成：${products.length} 个型号、${variantTotal} 个变体、` +
      `${cartonTotal} 条纸箱记录，其中 ${flaggedTotal} 个变体标记为待核对。`,
  );
  console.log(`Product OS：分类 ${categoryTotal} 个（两层），人民币价格 ${cnyPrices} 条。`);
  if (missingImages.length) {
    console.log(`Product OS：以下型号暂无产品图，需补充：${missingImages.join('、')}`);
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
