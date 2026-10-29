/**
 * 2026 新品与规格补全（2026-10-29）
 *
 * 数据来源（逐项核对过原文件）：
 *   docs/product-os/catalog-2026-mattress-bed.json  压缩床垫 7 款 + 压缩床 6 款（中文规格书 + 美元报价单）
 *   docs/product-os/catalog-2026-smart-mattress.json 智能电动床垫 7 款（中文图册 + 人民币价格表）
 *
 * 做三件事，可重复执行：
 *   1. 缺的型号整套新建（变体、纸箱、价格、材料、面料、MOQ、主图、检索文本）；已有的型号不重建。
 *   2. 已有型号按新规格补全：M-801 的材料、90 cm 的 CBM、待核对说明与美元价，C-301 ~ C-306 的 CBM。
 *      只改仍是旧种子值的字段；人工改过的保留并列入返回结果（部署日志可见）。
 *   3. 智能电动床垫放在「智能床垫系列」下的新二级分类。
 *
 * 种子在最后调用它（全新库直接得到新数据）；已上线的库由 scripts/production-init.mjs 每次部署调用。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { Prisma, type PrismaClient } from '@prisma/client';
import { cbmNeedsReview, parsePacking } from '../lib/product-packing';

const MATTRESS_BED_SOURCE = 'docs/product-os/catalog-2026-mattress-bed.json';
const SMART_SOURCE = 'docs/product-os/catalog-2026-smart-mattress.json';

/** 美元报价单（13 Oct 2026）与智能电动床垫价格表各自一个价格表键，与 2026 报价表的价格并存。 */
export const PRICE_LIST_MATTRESS_USD = 'LVANJU-MATTRESS-2026-10';
export const PRICE_LIST_SMART_CNY = 'LVANJU-SMART-2026';

const TAG_SOURCE = '[来源] ';
const TAG_MATH = '[算术] ';
const TAG_MISSING = '[资料缺失] ';

const MOQ_TIERS = [
  { channel: 'ONLINE', channelLabelCn: '线上', minQty: 10 },
  { channel: 'OFFLINE', channelLabelCn: '线下交谈', minQty: 20 },
] as const;

type Material = { cn: string; en: string };
type MattressSize = { size: number[]; packing: string; cbm: number; weightKg: number; usd: number };
type MattressBedData = {
  mattresses: { model: string; featureCn?: string; featureEn?: string; materials: Material[]; sizes: MattressSize[] }[];
  beds: { model: string; size: number[]; packing: string; cbm: number; weightKg: number }[];
};
type SmartData = {
  category: { code: string; nameCn: string; nameEn: string; parent: string };
  priceTerms: { incoterm: string; currency: string };
  common: { presetModes: number; motor: string; frame: string; remote: string; coverLayer: string; maxLoadKg: number; warrantyYears: number };
  models: {
    model: string; image: string; positioning: string; positioningCatalog: string; taglineCn: string;
    comfort: number; featuresCn: string; layersCn: string[]; unconfirmed?: string[]; cny: number[];
  }[];
  sizes: { size: number[]; packing: string; cbm: number; weightKg: number }[];
};

/** 准备写入的一个型号（新建时整套写入）。 */
type ProductPlan = {
  model: string;
  categoryCode: string;
  nameCn: string;
  nameEn: string;
  descriptionCn: string;
  descriptionEn: string;
  image: string;
  materials: Material[];
  variants: {
    dims: number[];
    packingRaw: string;
    cbm: number;
    grossWeightKg: number;
    reviewNotes: string[];
    price: { priceListKey: string; currency: string; incoterm: string; amount: number; effectiveFrom: Date };
  }[];
};

/**
 * 旧种子写入的值（docs/product-os/source-extract*.json 推导）。只有当前值仍等于它们时才改，
 * 否则说明有人在系统里改过，保留人工值。
 */
const M801_PREVIOUS = {
  materials: [
    { role: 'FILLING', nameEn: '', nameCn: '18cm独立袋装弹簧' },
    { role: 'COVER', nameEn: '', nameCn: '针织布外套' },
  ],
  searchText: 'M-801 | Compressed Mattress M-801 | 压缩床垫 M-801 | 18cm独立袋装弹簧 | 针织布外套 | 90x200x20 120x200x20 150x200x20 180x200x20',
  cbm: { 'M-801-90x200x20': 0.104 } as Record<string, number>,
  /** 中文报价表是唯一的毛重来源时种子写下的提示；2026 规格书已给出同样的毛重。 */
  weightNote: (kg: number) => `${TAG_SOURCE}毛重取自中文报价表（${kg}kg）`,
};
const BED_PREVIOUS_CBM = 0.2;

/** 面料行（含床垫外罩）记为 COVER，其余按名称判断分层角色，与种子一致。 */
function materialRole(material: Material): string {
  if (/面料|外罩|fabric|cover/i.test(material.cn || material.en)) return 'COVER';
  const name = material.en || material.cn;
  if (/frame|steel|钢架|钢骨|功能架/i.test(name)) return 'FRAME';
  if (/foam|sponge|海绵/i.test(name)) return 'FOAM';
  if (/cotton|fiber|fibre|feather|filling|particle|spring|绵|棉|丝|绒|弹簧|记忆/i.test(name)) return 'FILLING';
  return 'OTHER';
}

const skuFor = (model: string, dims: number[]) => `${model}-${dims.join('x')}`;

function packingNotes(packingRaw: string, cbm: number) {
  const packing = parsePacking(packingRaw);
  const notes: string[] = [];
  if (cbmNeedsReview(cbm, packing.computedCbm)) notes.push(`${TAG_MATH}CBM 与包装不一致：采用 ${cbm}，按包装推导 ${packing.computedCbm}`);
  notes.push(...packing.notes.map(n => `${TAG_MATH}${n}`));
  return { packing, notes };
}

function searchTextFor(plan: { model: string; nameEn: string; nameCn: string; materials: Material[]; dims: number[][] }) {
  return [
    plan.model,
    plan.nameEn,
    plan.nameCn,
    plan.materials.map(m => m.en).filter(Boolean).join(' '),
    plan.materials.map(m => m.cn).filter(Boolean).join(' '),
    plan.dims.map(d => d.join('x')).join(' '),
  ].filter(Boolean).join(' | ');
}

function loadPlans(): { plans: ProductPlan[]; mattressBed: MattressBedData; smart: SmartData } {
  const mattressBed = JSON.parse(readFileSync(MATTRESS_BED_SOURCE, 'utf8')) as MattressBedData;
  const smart = JSON.parse(readFileSync(SMART_SOURCE, 'utf8')) as SmartData;
  const plans: ProductPlan[] = [];

  for (const m of mattressBed.mattresses) {
    plans.push({
      model: m.model,
      categoryCode: 'SERIES_M_MATTRESS',
      nameCn: `压缩床垫 ${m.model}`,
      nameEn: `Compressed Mattress ${m.model}`,
      descriptionCn: m.featureCn ?? '',
      descriptionEn: m.featureEn ?? '',
      image: `${m.model}.jpg`,
      materials: m.materials,
      variants: m.sizes.map(s => ({
        dims: s.size,
        packingRaw: s.packing,
        cbm: s.cbm,
        grossWeightKg: s.weightKg,
        reviewNotes: [],
        price: { priceListKey: PRICE_LIST_MATTRESS_USD, currency: 'USD', incoterm: 'FOB', amount: s.usd, effectiveFrom: new Date('2026-10-13T00:00:00.000Z') },
      })),
    });
  }

  const c = smart.common;
  for (const m of smart.models) {
    const unconfirmed = m.unconfirmed ?? [];
    const motor = unconfirmed.includes('motor') ? `${c.motor}（待确认）` : c.motor;
    const frame = unconfirmed.includes('frame') ? `${c.frame}（待确认）` : c.frame;
    const notes = [`${TAG_MISSING}价格表未给床垫厚度`];
    if (unconfirmed.length) notes.push(`${TAG_SOURCE}图册把电机与功能架标为待确认（[德国 OKIN 电机]、[12 cm]）`);
    plans.push({
      model: m.model,
      categoryCode: smart.category.code,
      nameCn: `智能电动床垫 ${m.model}`,
      nameEn: `Smart Electric Mattress ${m.model}`,
      descriptionCn: [
        m.taglineCn,
        `定位：${m.positioning}（图册：${m.positioningCatalog}）；舒适度 ${m.comfort}/10（1 最硬，10 最软）；附加功能：${m.featuresCn}。`,
        `${c.presetModes} 种预设模式；${motor}；${frame}；${c.remote}；${c.coverLayer}；最大承重 ${c.maxLoadKg} 公斤；质保 ${c.warrantyYears} 年。`,
      ].join('\n'),
      descriptionEn: '',
      image: m.image,
      materials: m.layersCn.map(cn => ({ cn, en: '' })),
      variants: smart.sizes.map((s, i) => ({
        dims: s.size,
        packingRaw: s.packing,
        cbm: s.cbm,
        grossWeightKg: s.weightKg,
        reviewNotes: notes,
        price: { priceListKey: PRICE_LIST_SMART_CNY, currency: smart.priceTerms.currency, incoterm: smart.priceTerms.incoterm, amount: m.cny[i], effectiveFrom: new Date('2026-01-01T00:00:00.000Z') },
      })),
    });
  }
  return { plans, mattressBed, smart };
}

type Result = { created: string[]; updated: string[]; kept: string[] };

async function ensureSmartCategory(db: PrismaClient, smart: SmartData, log: (m: string) => void) {
  const existing = await db.productCategory.findUnique({ where: { code: smart.category.code } });
  if (existing) return existing.id;
  const parent = await db.productCategory.findUnique({ where: { code: smart.category.parent } });
  if (!parent) {
    log(`2026 新品：缺少一级分类 ${smart.category.parent}，智能电动床垫暂不导入`);
    return null;
  }
  const sort = await db.productCategory.count({ where: { level: 2 } });
  const created = await db.productCategory.create({
    data: { code: smart.category.code, nameCn: smart.category.nameCn, nameEn: smart.category.nameEn, level: 2, codePrefix: '', sort, parentId: parent.id },
  });
  log(`2026 新品：新增分类 ${smart.category.nameCn}（${smart.category.code}）`);
  return created.id;
}

async function createProduct(db: PrismaClient, plan: ProductPlan, categoryId: string, seriesId: string | null, ownerId: string) {
  const imageFile = `public/products/${plan.image}`;
  await db.$transaction(async tx => {
    const product = await tx.product.create({
      data: {
        model: plan.model, nameCn: plan.nameCn, nameEn: plan.nameEn, categoryId, seriesId, status: 'ACTIVE', lengthLabel: '',
        leadTimeDays: 15, qaMonths: 12, descriptionCn: plan.descriptionCn, descriptionEn: plan.descriptionEn, createdBy: ownerId,
      },
    });
    await tx.productMaterial.createMany({
      data: plan.materials.map((m, sort) => ({ productId: product.id, role: materialRole(m), nameEn: m.en, nameCn: m.cn, specEn: '', sort })),
    });
    const cover = plan.materials.find(m => materialRole(m) === 'COVER');
    if (cover) {
      await tx.productOption.create({ data: { productId: product.id, kind: 'FABRIC', code: '', nameEn: cover.en, nameCn: cover.cn, isDefault: true, sort: 0 } });
    }
    await tx.productMoq.createMany({
      data: MOQ_TIERS.map(t => ({ productId: product.id, channel: t.channel, channelLabelCn: t.channelLabelCn, minQty: t.minQty, note: '业务确认 2026-09-22' })),
    });
    for (const v of plan.variants) {
      const { packing, notes } = packingNotes(v.packingRaw, v.cbm);
      const reviewNotes = [...notes, ...v.reviewNotes];
      const variant = await tx.productVariant.create({
        data: {
          productId: product.id, sku: skuFor(plan.model, v.dims), variantType: 'CONFIGURATION', labelEn: '', labelCn: '',
          lengthCm: v.dims[0] ?? null, widthCm: v.dims[1] ?? null, heightCm: v.dims[2] ?? null,
          secondaryLabelEn: '', secondaryLabelCn: '', bedSizeCm: '',
          packingRaw: v.packingRaw, cartonCount: packing.cartonCount,
          cbm: new Prisma.Decimal(v.cbm), cbmComputed: new Prisma.Decimal(packing.computedCbm),
          grossWeightKg: new Prisma.Decimal(v.grossWeightKg), grossWeightRaw: String(v.grossWeightKg),
          needsReview: reviewNotes.length > 0, reviewNote: reviewNotes.join('；'), status: 'ACTIVE', createdBy: ownerId,
        },
      });
      if (packing.cartons.length) {
        await tx.packingCarton.createMany({
          data: packing.cartons.map((carton, sort) => ({ variantId: variant.id, ...carton, grossWeightKg: null, sort })),
        });
      }
      await tx.productPrice.create({
        data: {
          variantId: variant.id, priceListKey: v.price.priceListKey, currency: v.price.currency, incoterm: v.price.incoterm,
          includesFreight: false, customerTier: 'ALL', minQty: 1, unitPrice: new Prisma.Decimal(v.price.amount),
          effectiveFrom: v.price.effectiveFrom, status: 'ACTIVE', createdBy: ownerId,
        },
      });
    }
    if (existsSync(imageFile)) {
      await tx.productMedia.create({
        data: {
          productId: product.id, role: 'HERO', storageKey: `products/${plan.image}`, mimeType: 'image/jpeg', fileName: plan.image,
          size: statSync(imageFile).size, sort: 0, createdBy: ownerId,
        },
      });
    }
    await tx.productAiProfile.create({
      data: {
        productId: product.id, sellingPointsJson: '[]', advantagesJson: '[]', useCasesJson: '[]', bestCustomerJson: '[]',
        recommendedMarketJson: '[]', keywordsJson: '[]', status: 'DRAFT',
        searchText: searchTextFor({ ...plan, dims: plan.variants.map(v => v.dims) }),
      },
    });
  });
}

/** M-801：已在库（来自中文报价表），按 2026 规格书补全；每组字段受保护。 */
async function completeM801(db: PrismaClient, plan: ProductPlan, ownerId: string, result: Result) {
  const product = await db.product.findUnique({
    where: { model: plan.model },
    include: { materials: { orderBy: { sort: 'asc' } }, aiProfile: true, variants: { where: { deletedAt: null }, include: { prices: true } } },
  });
  if (!product || product.deletedAt) return;
  const changes: string[] = [];

  const currentMaterials = product.materials.map(m => ({ role: m.role, nameEn: m.nameEn, nameCn: m.nameCn }));
  const newMaterials = plan.materials.map(m => ({ role: materialRole(m), nameEn: m.en, nameCn: m.cn }));
  if (JSON.stringify(currentMaterials) === JSON.stringify(M801_PREVIOUS.materials)) {
    await db.$transaction([
      db.productMaterial.deleteMany({ where: { productId: product.id } }),
      db.productMaterial.createMany({ data: newMaterials.map((m, sort) => ({ ...m, productId: product.id, specEn: '', sort })) }),
    ]);
    changes.push('材料');
  } else if (JSON.stringify(currentMaterials) !== JSON.stringify(newMaterials)) {
    result.kept.push(`${plan.model} 的材料`);
  }

  const searchText = searchTextFor({ ...plan, dims: plan.variants.map(v => v.dims) });
  if (product.aiProfile && product.aiProfile.searchText === M801_PREVIOUS.searchText) {
    await db.productAiProfile.update({ where: { productId: product.id }, data: { searchText } });
  } else if (product.aiProfile && product.aiProfile.searchText !== searchText) {
    result.kept.push(`${plan.model} 的检索文本`);
  }

  for (const v of plan.variants) {
    const sku = skuFor(plan.model, v.dims);
    const variant = product.variants.find(row => row.sku === sku);
    if (!variant) continue;
    const data: Prisma.ProductVariantUpdateInput = {};
    const previousCbm = M801_PREVIOUS.cbm[sku];
    if (previousCbm !== undefined && Math.abs(Number(variant.cbm) - previousCbm) < 1e-6) data.cbm = new Prisma.Decimal(v.cbm);
    else if (Math.abs(Number(variant.cbm) - v.cbm) > 1e-6) result.kept.push(`${sku} 的 CBM`);
    const cbm = data.cbm ? v.cbm : Number(variant.cbm);
    // 规格书给出了与中文报价表相同的毛重，原「毛重取自中文报价表」的提示不再需要；只在说明仍是种子原文时替换
    if (variant.reviewNote === M801_PREVIOUS.weightNote(Number(variant.grossWeightKg)) && Number(variant.grossWeightKg) === v.grossWeightKg) {
      const { notes } = packingNotes(variant.packingRaw, cbm);
      data.reviewNote = notes.join('；');
      data.needsReview = notes.length > 0;
    }
    if (Object.keys(data).length) {
      await db.productVariant.update({ where: { id: variant.id }, data });
      changes.push(`${sku} ${[data.cbm ? `CBM ${previousCbm} → ${v.cbm}` : '', data.reviewNote !== undefined ? '待核对说明' : ''].filter(Boolean).join('、')}`);
    }
    const hasUsd = variant.prices.some(p => p.priceListKey === v.price.priceListKey && p.currency === v.price.currency);
    if (!hasUsd) {
      await db.productPrice.create({
        data: {
          variantId: variant.id, priceListKey: v.price.priceListKey, currency: v.price.currency, incoterm: v.price.incoterm,
          includesFreight: false, customerTier: 'ALL', minQty: 1, unitPrice: new Prisma.Decimal(v.price.amount),
          effectiveFrom: v.price.effectiveFrom, status: 'ACTIVE', createdBy: ownerId,
        },
      });
      changes.push(`${sku} 补 USD ${v.price.amount}`);
    }
  }
  if (changes.length) result.updated.push(`${plan.model}（${changes.join('；')}）`);
}

/** C-301 ~ C-306：规格书的 CBM 是三件包装体积之和 0.194，原报价表四舍五入为 0.2。 */
async function completeBeds(db: PrismaClient, beds: MattressBedData['beds'], result: Result) {
  for (const bed of beds) {
    const sku = skuFor(bed.model, bed.size);
    const variant = await db.productVariant.findFirst({ where: { sku, deletedAt: null } });
    if (!variant) continue;
    const current = Number(variant.cbm);
    if (Math.abs(current - bed.cbm) < 1e-6) continue;
    if (Math.abs(current - BED_PREVIOUS_CBM) < 1e-6) {
      await db.productVariant.update({ where: { id: variant.id }, data: { cbm: new Prisma.Decimal(bed.cbm) } });
      result.updated.push(`${sku}（CBM ${BED_PREVIOUS_CBM} → ${bed.cbm}）`);
    } else {
      result.kept.push(`${sku} 的 CBM`);
    }
  }
}

export async function applyProducts2026(db: PrismaClient, log: (message: string) => void = () => {}): Promise<Result> {
  const result: Result = { created: [], updated: [], kept: [] };
  const owner = await db.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  const mattressCategory = await db.productCategory.findUnique({ where: { code: 'SERIES_M_MATTRESS' } });
  // 空库或分类尚未初始化（种子会先建分类再调用这里）
  if (!owner || !mattressCategory) return result;

  const { plans, mattressBed, smart } = loadPlans();
  const smartCategoryId = await ensureSmartCategory(db, smart, log);
  // 新压缩床垫沿用库里 M 系列已有的系列归属
  const mattressSeries = await db.product.findFirst({ where: { categoryId: mattressCategory.id, deletedAt: null }, select: { seriesId: true } });
  const existing = new Set((await db.product.findMany({ where: { model: { in: plans.map(p => p.model) } }, select: { model: true } })).map(p => p.model));

  for (const plan of plans) {
    if (existing.has(plan.model)) continue;
    const categoryId = plan.categoryCode === 'SERIES_M_MATTRESS' ? mattressCategory.id : smartCategoryId;
    if (!categoryId) continue;
    const seriesId = plan.categoryCode === 'SERIES_M_MATTRESS' ? mattressSeries?.seriesId ?? null : null;
    await createProduct(db, plan, categoryId, seriesId, owner.id);
    result.created.push(plan.model);
  }

  const m801 = plans.find(p => p.model === 'M-801');
  if (m801 && existing.has('M-801')) await completeM801(db, m801, owner.id, result);
  await completeBeds(db, mattressBed.beds, result);

  if (result.created.length) log(`2026 新品：新增 ${result.created.length} 个型号：${result.created.join('、')}`);
  if (result.updated.length) log(`2026 新品：按新规格补全 ${result.updated.join('；')}`);
  if (result.kept.length) log(`2026 新品：以下字段已被人工修改，保留现值未动：${result.kept.join('；')}`);
  return result;
}
