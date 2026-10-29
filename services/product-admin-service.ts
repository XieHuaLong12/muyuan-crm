import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { cbmNeedsReview, parsePacking } from '@/lib/product-packing';

/**
 * 产品库上架管理（仅管理员）
 *
 *   手动上架：在产品库里新增 / 编辑型号、尺寸、包装、价格、材料，上传主图，自己点「上架」「下架」。
 *   自动上架：上架方式选「自动」后，资料齐全（主图、尺寸、价格）就自动上架；缺了任何一项回到「待上架」。
 *
 * 状态沿用 Product.status：ACTIVE 已上架（报价可选）/ DRAFT 待上架 / ARCHIVED 已下架。
 * 产品图在浏览器里处理成 1200 × 900 白底 JPEG 再上传，存进 ProductImageFile，由 /media/products/<文件> 读取。
 */

export const LISTING_MODES = ['AUTO', 'MANUAL'] as const;
export const STATUS_LABEL: Record<string, string> = { ACTIVE: '已上架', DRAFT: '待上架', ARCHIVED: '已下架' };
export const PRODUCT_IMAGE = { width: 1200, height: 900, maxBytes: 3 * 1024 * 1024, prefix: 'media/products/' } as const;

/** 在产品库里录入或修改的价格，归在这个价格表键下，与导入的报价表价格区分。 */
export const MANUAL_PRICE_LIST = 'MANUAL';
const INCOTERMS = ['FOB', 'EXW', 'CIF', 'DDP'] as const;
const MOQ_TIERS = [
  { channel: 'ONLINE', channelLabelCn: '线上', minQty: 10 },
  { channel: 'OFFLINE', channelLabelCn: '线下交谈', minQty: 20 },
] as const;

const text = (max: number) => z.string().trim().max(max);
const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const size = z.coerce.number({ invalid_type_error: '尺寸要填数字' }).int('尺寸填整数厘米').min(1, '尺寸至少 1 cm').max(2000, '尺寸不超过 2000 cm');
const optionalSize = z.preprocess(blankToNull, size.nullable());
const optionalAmount = (max: number, message: string) =>
  z.preprocess(blankToNull, z.coerce.number({ invalid_type_error: message }).min(0, message).max(max, message).nullable());

const variantInput = z.object({
  id: z.string().trim().max(40).optional(),
  labelCn: text(120).default(''),
  labelEn: text(120).default(''),
  lengthCm: size,
  widthCm: size,
  heightCm: optionalSize.default(null),
  packingRaw: text(300).default(''),
  cbm: optionalAmount(50, 'CBM 要在 0 ~ 50 之间').default(null),
  grossWeightKg: optionalAmount(5000, '毛重要在 0 ~ 5000 kg 之间').default(null),
  priceUsd: optionalAmount(10_000_000, '美元价格式不对').default(null),
  priceCny: optionalAmount(10_000_000, '人民币价格式不对').default(null),
});

const productFields = {
  categoryCode: z.string().trim().min(1, '请选择分类').max(40),
  nameCn: text(200).default(''),
  nameEn: text(200).default(''),
  descriptionCn: text(4000).default(''),
  descriptionEn: text(4000).default(''),
  incoterm: z.enum(INCOTERMS).default('FOB'),
  listingMode: z.enum(LISTING_MODES).default('AUTO'),
  materials: z.array(z.object({ cn: text(200).default(''), en: text(200).default('') })).max(30).default([]),
  variants: z.array(variantInput).min(1, '至少填写一个尺寸').max(40, '一个型号最多 40 个尺寸'),
};

const createInput = z.object({
  model: z.string().trim().min(1, '请填写型号').max(64, '型号最长 64 个字符').regex(/^[^\s/\\?#%&]+$/, '型号不能含空格或 / \\ ? # % &'),
  ...productFields,
});
const updateInput = z.object(productFields);
const listingInput = z.object({ action: z.enum(['LIST', 'UNLIST', 'AUTO'], { errorMap: () => ({ message: '未知的上架操作' }) }) });

type Tx = Prisma.TransactionClient;
type VariantInput = z.infer<typeof variantInput>;

/** 面料行记为 COVER，其余按名称判断分层角色（与种子、2026 新品导入一致）。 */
function materialRole(m: { cn: string; en: string }) {
  if (/面料|外罩|fabric|cover/i.test(m.cn || m.en)) return 'COVER';
  const name = m.en || m.cn;
  if (/frame|steel|钢架|钢骨|功能架/i.test(name)) return 'FRAME';
  if (/foam|sponge|海绵/i.test(name)) return 'FOAM';
  if (/cotton|fiber|fibre|feather|filling|particle|spring|绵|棉|丝|绒|弹簧|记忆/i.test(name)) return 'FILLING';
  return 'OTHER';
}

const dimsOf = (v: { lengthCm: number | null; widthCm: number | null; heightCm: number | null }) =>
  [v.lengthCm, v.widthCm, v.heightCm].filter((n): n is number => typeof n === 'number' && n > 0);

/** 上架缺什么：主图、尺寸、价格。 */
async function readiness(tx: Tx | typeof db, productId: string) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: {
      status: true,
      listingMode: true,
      media: { where: { role: 'HERO' }, select: { id: true }, take: 1 },
      variants: {
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { lengthCm: true, widthCm: true, prices: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 } },
      },
    },
  });
  if (!product) throw new HttpError(404, '产品不存在');
  const missing: string[] = [];
  if (!product.media.length) missing.push('主图');
  if (!product.variants.some(v => v.lengthCm && v.widthCm)) missing.push('尺寸');
  if (!product.variants.some(v => v.prices.length)) missing.push('价格');
  return { product, missing };
}

/** 自动上架的型号按资料是否齐全切换「已上架 / 待上架」；手动上架的不动。 */
async function applyAutoListing(tx: Tx, productId: string) {
  const { product, missing } = await readiness(tx, productId);
  if (product.listingMode !== 'AUTO') return product.status;
  const status = missing.length ? 'DRAFT' : 'ACTIVE';
  if (status !== product.status) await tx.product.update({ where: { id: productId }, data: { status } });
  return status;
}

async function rebuildSearchText(tx: Tx, productId: string) {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    include: {
      materials: { orderBy: { sort: 'asc' } },
      variants: { where: { deletedAt: null }, orderBy: { sku: 'asc' }, select: { lengthCm: true, widthCm: true, heightCm: true } },
    },
  });
  const searchText = [
    product.model,
    product.nameEn,
    product.nameCn,
    product.lengthLabel,
    product.materials.map(m => m.nameEn).filter(Boolean).join(' '),
    product.materials.map(m => m.nameCn).filter(Boolean).join(' '),
    product.variants.map(v => dimsOf(v).join('x')).join(' '),
  ].filter(Boolean).join(' | ');
  await tx.productAiProfile.upsert({
    where: { productId },
    create: {
      productId, searchText, status: 'DRAFT', sellingPointsJson: '[]', advantagesJson: '[]', useCasesJson: '[]',
      bestCustomerJson: '[]', recommendedMarketJson: '[]', keywordsJson: '[]',
    },
    update: { searchText },
  });
}

async function writeMaterials(tx: Tx, productId: string, materials: { cn: string; en: string }[]) {
  const rows = materials.filter(m => m.cn || m.en);
  await tx.productMaterial.deleteMany({ where: { productId } });
  if (rows.length) {
    await tx.productMaterial.createMany({
      data: rows.map((m, sort) => ({ productId, role: materialRole(m), nameCn: m.cn, nameEn: m.en, specEn: '', sort })),
    });
  }
}

/** 一个币种只保留一条在用的价格：改价改这条，清空就停用，没有就新建在 MANUAL 价格表下。 */
async function writePrice(tx: Tx, variantId: string, currency: 'USD' | 'CNY', amount: number | null, incoterm: string, userId: string) {
  const current = await tx.productPrice.findMany({
    where: { variantId, currency, status: 'ACTIVE', customerTier: 'ALL', minQty: 1 },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (amount === null) {
    if (current.length) await tx.productPrice.updateMany({ where: { id: { in: current.map(p => p.id) } }, data: { status: 'ARCHIVED', effectiveTo: new Date() } });
    return;
  }
  const [keep, ...others] = current;
  if (others.length) await tx.productPrice.updateMany({ where: { id: { in: others.map(p => p.id) } }, data: { status: 'ARCHIVED', effectiveTo: new Date() } });
  if (keep && keep.incoterm === incoterm) {
    if (!keep.unitPrice.equals(amount)) await tx.productPrice.update({ where: { id: keep.id }, data: { unitPrice: new Prisma.Decimal(amount) } });
    return;
  }
  if (keep) await tx.productPrice.update({ where: { id: keep.id }, data: { status: 'ARCHIVED', effectiveTo: new Date() } });
  const key = { variantId, priceListKey: MANUAL_PRICE_LIST, currency, incoterm, customerTier: 'ALL', minQty: 1 };
  await tx.productPrice.upsert({
    where: { variantId_priceListKey_currency_incoterm_customerTier_minQty: key },
    create: {
      ...key, includesFreight: false, unitPrice: new Prisma.Decimal(amount), effectiveFrom: new Date(), status: 'ACTIVE', createdBy: userId,
    },
    update: { unitPrice: new Prisma.Decimal(amount), status: 'ACTIVE', effectiveTo: null },
  });
}

async function freeSku(tx: Tx, base: string, ownId?: string) {
  for (let n = 1; n < 100; n += 1) {
    const sku = n === 1 ? base : `${base}-${n}`;
    const taken = await tx.productVariant.findUnique({ where: { sku }, select: { id: true } });
    if (!taken || taken.id === ownId) return sku;
  }
  throw new HttpError(409, `规格编号 ${base} 重复太多，请调整尺寸`);
}

function variantValues(v: VariantInput) {
  const packing = parsePacking(v.packingRaw);
  const cbm = v.cbm ?? packing.computedCbm;
  const weight = v.grossWeightKg ?? 0;
  const mathNotes: string[] = [];
  if (v.packingRaw && cbm && cbmNeedsReview(cbm, packing.computedCbm)) {
    mathNotes.push(`[算术] CBM 与包装不一致：采用 ${cbm}，按包装推导 ${packing.computedCbm}`);
  }
  mathNotes.push(...packing.notes.map(n => `[算术] ${n}`));
  return { packing, cbm, weight, mathNotes };
}

async function writeVariants(tx: Tx, product: { id: string; model: string }, input: z.infer<typeof updateInput>, user: Actor) {
  const existing = await tx.productVariant.findMany({ where: { productId: product.id, deletedAt: null } });
  const byId = new Map(existing.map(v => [v.id, v]));
  const kept = new Set<string>();
  const stamp = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  for (const v of input.variants) {
    const { packing, cbm, weight, mathNotes } = variantValues(v);
    const base = `${product.model}-${dimsOf(v).join('x')}`;
    const shared = {
      labelCn: v.labelCn,
      labelEn: v.labelEn,
      lengthCm: v.lengthCm,
      widthCm: v.widthCm,
      heightCm: v.heightCm,
      packingRaw: v.packingRaw,
      cartonCount: packing.cartonCount || 1,
      cbm: new Prisma.Decimal(cbm),
      cbmComputed: new Prisma.Decimal(packing.computedCbm),
      grossWeightKg: new Prisma.Decimal(weight),
    };
    let variantId: string;
    let packingChanged = true;
    if (v.id) {
      const current = byId.get(v.id);
      if (!current) throw new HttpError(400, '尺寸规格已被删除或不属于该型号，请刷新后再改');
      kept.add(current.id);
      variantId = current.id;
      const changed = current.lengthCm !== v.lengthCm || current.widthCm !== v.widthCm || current.heightCm !== v.heightCm
        || current.packingRaw !== v.packingRaw || !current.cbm.equals(cbm) || !current.grossWeightKg.equals(weight);
      packingChanged = current.packingRaw !== v.packingRaw;
      await tx.productVariant.update({
        where: { id: current.id },
        data: {
          ...shared,
          sku: base === current.sku ? current.sku : await freeSku(tx, base, current.id),
          ...(current.grossWeightKg.equals(weight) ? {} : { grossWeightRaw: String(weight) }),
          // 管理员改过尺寸 / 包装 / CBM / 毛重，就算人工核对过：只留仍算不通的提示
          ...(changed
            ? { needsReview: mathNotes.length > 0, reviewNote: [...mathNotes, `[已确认] ${user.name} 于 ${stamp} 在产品库修改`].join('；') }
            : {}),
        },
      });
    } else {
      const created = await tx.productVariant.create({
        data: {
          ...shared,
          productId: product.id,
          sku: await freeSku(tx, base),
          variantType: 'CONFIGURATION',
          secondaryLabelEn: '',
          secondaryLabelCn: '',
          bedSizeCm: '',
          grossWeightRaw: String(weight),
          needsReview: mathNotes.length > 0,
          reviewNote: mathNotes.join('；'),
          status: 'ACTIVE',
          createdBy: user.id,
        },
      });
      variantId = created.id;
    }
    if (packingChanged) {
      await tx.packingCarton.deleteMany({ where: { variantId } });
      if (packing.cartons.length) {
        await tx.packingCarton.createMany({ data: packing.cartons.map((carton, sort) => ({ ...carton, variantId, grossWeightKg: null, sort })) });
      }
    }
    await writePrice(tx, variantId, 'USD', v.priceUsd, input.incoterm, user.id);
    await writePrice(tx, variantId, 'CNY', v.priceCny, input.incoterm, user.id);
  }

  // 表单里删掉的尺寸：软删除并停用，历史报价单仍能看到原记录
  const removed = existing.filter(v => !kept.has(v.id));
  if (removed.length) {
    await tx.productVariant.updateMany({ where: { id: { in: removed.map(v => v.id) } }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
  }
}

async function categoryFor(code: string) {
  const category = await db.productCategory.findUnique({ where: { code } });
  if (!category || category.level !== 2) throw new HttpError(400, '请选择具体的产品分类');
  return category;
}

export async function createProduct(user: Actor, input: unknown) {
  requireAdmin(user);
  const v = createInput.parse(input);
  const category = await categoryFor(v.categoryCode);
  if (await db.product.findUnique({ where: { model: v.model }, select: { id: true } })) {
    throw new HttpError(409, `型号 ${v.model} 已存在，请直接编辑它`);
  }
  return db.$transaction(async tx => {
    const product = await tx.product.create({
      data: {
        model: v.model,
        nameCn: v.nameCn || `${category.nameCn} ${v.model}`,
        nameEn: v.nameEn || `${category.nameEn} ${v.model}`,
        categoryId: category.id,
        status: 'DRAFT',
        listingMode: v.listingMode,
        lengthLabel: '',
        descriptionCn: v.descriptionCn,
        descriptionEn: v.descriptionEn,
        createdBy: user.id,
      },
    });
    await writeMaterials(tx, product.id, v.materials);
    const cover = v.materials.find(m => (m.cn || m.en) && materialRole(m) === 'COVER');
    if (cover) await tx.productOption.create({ data: { productId: product.id, kind: 'FABRIC', code: '', nameCn: cover.cn, nameEn: cover.en, isDefault: true, sort: 0 } });
    await tx.productMoq.createMany({
      data: MOQ_TIERS.map(t => ({ productId: product.id, channel: t.channel, channelLabelCn: t.channelLabelCn, minQty: t.minQty, note: '业务确认 2026-09-22' })),
    });
    await writeVariants(tx, product, v, user);
    await rebuildSearchText(tx, product.id);
    const status = await applyAutoListing(tx, product.id);
    return { id: product.id, status };
  });
}

export async function updateProduct(user: Actor, id: string, input: unknown) {
  requireAdmin(user);
  const v = updateInput.parse(input);
  const product = await db.product.findFirst({ where: { id, deletedAt: null }, include: { materials: { orderBy: { sort: 'asc' } } } });
  if (!product) throw new HttpError(404, '产品不存在');
  const category = await categoryFor(v.categoryCode);
  return db.$transaction(async tx => {
    await tx.product.update({
      where: { id },
      data: {
        categoryId: category.id,
        nameCn: v.nameCn || product.nameCn,
        nameEn: v.nameEn || product.nameEn,
        descriptionCn: v.descriptionCn,
        descriptionEn: v.descriptionEn,
        listingMode: v.listingMode,
      },
    });
    const before = product.materials.map(m => [m.nameCn, m.nameEn].join('|')).join('\n');
    const after = v.materials.filter(m => m.cn || m.en).map(m => [m.cn, m.en].join('|')).join('\n');
    if (before !== after) await writeMaterials(tx, id, v.materials);
    await writeVariants(tx, product, v, user);
    await rebuildSearchText(tx, id);
    const status = await applyAutoListing(tx, id);
    return { id, status };
  });
}

/** 上架 / 下架 / 改为自动上架。手动上下架会把上架方式改为手动，自动规则就不会再把它改回来。 */
export async function setListing(user: Actor, id: string, input: unknown) {
  requireAdmin(user);
  const { action } = listingInput.parse(input);
  const product = await db.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!product) throw new HttpError(404, '产品不存在');
  return db.$transaction(async tx => {
    if (action === 'AUTO') {
      await tx.product.update({ where: { id }, data: { listingMode: 'AUTO' } });
      await applyAutoListing(tx, id);
    } else {
      await tx.product.update({ where: { id }, data: { listingMode: 'MANUAL', status: action === 'LIST' ? 'ACTIVE' : 'ARCHIVED' } });
    }
    const { product: after, missing } = await readiness(tx, id);
    return { id, status: after.status, listingMode: after.listingMode, missing };
  });
}

/** 读 JPEG 文件头里的宽高（SOF 段）。不是 JPEG 或读不到时返回 null。 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    // SOF0 ~ SOF15，排除 DHT(C4)、JPG(C8)、DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * 更换主图：页面已把图片处理成 1200 × 900 白底 JPEG。新图用新地址（浏览器和 CDN 不会显示旧缓存），
 * 原主图降为图库图片，历史报价单引用的旧图仍可打开。
 */
export async function uploadProductImage(user: Actor, id: string, file: File) {
  requireAdmin(user);
  const product = await db.product.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!product) throw new HttpError(404, '产品不存在');
  if (file.size > PRODUCT_IMAGE.maxBytes) throw new HttpError(413, '图片不能超过 3 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dims = jpegSize(bytes);
  if (file.type !== 'image/jpeg' || !dims) throw new HttpError(400, '请上传 JPEG 图片');
  if (dims.width !== PRODUCT_IMAGE.width || dims.height !== PRODUCT_IMAGE.height) {
    throw new HttpError(400, `图片需为 ${PRODUCT_IMAGE.width} × ${PRODUCT_IMAGE.height}，请在产品页上传，系统会自动处理`);
  }
  const storageKey = `${PRODUCT_IMAGE.prefix}${randomUUID()}.jpg`;
  const fileName = (file.name || 'product.jpg').replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 120) || 'product.jpg';
  return db.$transaction(async tx => {
    await tx.productImageFile.create({
      data: { storageKey, mimeType: 'image/jpeg', width: dims.width, height: dims.height, size: bytes.length, data: Buffer.from(bytes), createdBy: user.id },
    });
    await tx.productMedia.updateMany({ where: { productId: id, role: 'HERO' }, data: { role: 'GALLERY', sort: 1 } });
    await tx.productMedia.create({
      data: {
        productId: id, role: 'HERO', storageKey, mimeType: 'image/jpeg', fileName, width: dims.width, height: dims.height,
        size: bytes.length, sort: 0, createdBy: user.id,
      },
    });
    const status = await applyAutoListing(tx, id);
    return { storageKey, status };
  });
}

/** /media/products/<文件> 读图（登录用户）。 */
export async function readProductImage(file: string) {
  if (!/^[0-9a-f-]{36}\.jpg$/.test(file)) throw new HttpError(404, '图片不存在');
  const image = await db.productImageFile.findUnique({ where: { storageKey: `${PRODUCT_IMAGE.prefix}${file}` }, select: { data: true, mimeType: true } });
  if (!image) throw new HttpError(404, '图片不存在');
  return image;
}

export type ProductEditorData = {
  categories: { code: string; label: string }[];
  product: null | {
    id: string;
    model: string;
    status: string;
    categoryCode: string;
    nameCn: string;
    nameEn: string;
    descriptionCn: string;
    descriptionEn: string;
    incoterm: string;
    listingMode: string;
    materials: { cn: string; en: string }[];
    variants: {
      id: string; sku: string; labelCn: string; labelEn: string; lengthCm: number | null; widthCm: number | null; heightCm: number | null;
      packingRaw: string; cbm: number | null; grossWeightKg: number | null; priceUsd: number | null; priceCny: number | null;
    }[];
  };
};

/** 新增 / 编辑页面需要的数据。 */
export async function productEditor(user: Actor, id: string | null): Promise<ProductEditorData> {
  requireAdmin(user);
  const roots = await db.productCategory.findMany({ where: { level: 1 }, orderBy: { sort: 'asc' }, include: { children: { orderBy: { sort: 'asc' } } } });
  const categories = roots.flatMap(root => root.children.map(child => ({ code: child.code, label: `${root.nameCn} › ${child.nameCn}` })));
  if (!id) return { categories, product: null };
  const product = await db.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: true,
      materials: { orderBy: { sort: 'asc' } },
      variants: {
        where: { deletedAt: null },
        orderBy: [{ cbm: 'asc' }, { sku: 'asc' }],
        include: { prices: { where: { status: 'ACTIVE', customerTier: 'ALL', minQty: 1 }, orderBy: { effectiveFrom: 'desc' } } },
      },
    },
  });
  if (!product) throw new HttpError(404, '产品不存在');
  const priceOf = (prices: { currency: string; unitPrice: Prisma.Decimal }[], currency: string) => {
    const row = prices.find(p => p.currency === currency);
    return row ? Number(row.unitPrice.toFixed(2)) : null;
  };
  const incoterm = product.variants.flatMap(v => v.prices).find(p => (INCOTERMS as readonly string[]).includes(p.incoterm))?.incoterm ?? 'FOB';
  return {
    categories,
    product: {
      id: product.id,
      model: product.model,
      status: product.status,
      categoryCode: product.category.code,
      nameCn: product.nameCn,
      nameEn: product.nameEn,
      descriptionCn: product.descriptionCn,
      descriptionEn: product.descriptionEn,
      incoterm,
      listingMode: product.listingMode,
      materials: product.materials.map(m => ({ cn: m.nameCn, en: m.nameEn })),
      variants: product.variants.map(v => ({
        id: v.id,
        sku: v.sku,
        labelCn: v.labelCn,
        labelEn: v.labelEn,
        lengthCm: v.lengthCm,
        widthCm: v.widthCm,
        heightCm: v.heightCm,
        packingRaw: v.packingRaw,
        cbm: Number(v.cbm),
        grossWeightKg: Number(v.grossWeightKg),
        priceUsd: priceOf(v.prices, 'USD'),
        priceCny: priceOf(v.prices, 'CNY'),
      })),
    },
  };
}

/** 产品详情页的上架信息：状态、上架方式、还缺什么。 */
export async function listingSummary(productId: string) {
  const { product, missing } = await readiness(db, productId);
  return { status: product.status, listingMode: product.listingMode, missing };
}
