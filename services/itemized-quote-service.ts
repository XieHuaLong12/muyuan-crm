import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { dayKey, localDate } from '@/lib/time';
import { retryTransaction } from '@/lib/transaction-retry';
import { quotationAmount } from '@/lib/quotation-amount';
import {
  QUOTE_CURRENCIES, QUOTE_INCOTERMS, QUOTE_LANGUAGES, computeFreight, computeTotals, languageForCurrency, quoteNumberFor, round2,
  type FreightBasis, type FreightResult, type QuoteLanguage,
} from '@/lib/quote-math';
import { QUOTE_LABELS, type QuoteTemplateText } from '@/lib/quote-i18n';
import { accessible } from './customer-service';
import { listFreightRates } from './freight-service';
import { quoteFxRates, quoteTemplates } from './quote-template-service';

/**
 * 产品库 → 报价单（多行报价）
 *
 *   - 单价由前端按「上次报价 → 价格表 → 汇率折算」智能带出，业务员可逐行修改；服务端只信任数量与单价，
 *     金额、合计与运费一律在这里重算（与前端共用 lib/quote-math，结果一致）
 *   - 报价单必须挂在客户名下：客户档案里能查到给他报过的每一份单据和每个规格的价格
 *   - 抬头、条款、运费计算过程保存为快照（documentJson），之后修改模板或运费库，已报出的单据不变
 *   - 权限沿用客户作用域：销售只能给自己的客户报价、只能看到自己客户的报价单
 *   - 成本只给管理员看（内部毛利参考），不进入单据，也不进入销售可见的任何返回值
 */

export const QUOTE_PREFIX = 'LVJ';
const LIST_PAGE_SIZE = 30;

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 年-月-日');
const shortText = (max: number) => z.string().trim().max(max, `最多 ${max} 个字`).default('');
const money = (label: string) =>
  z.coerce.number({ invalid_type_error: `请填写${label}` })
    .finite()
    .min(0, `${label}不能为负`)
    .max(10_000_000, `${label}过大`)
    .refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.001, `${label}最多两位小数`);

const lineInput = z.object({
  variantId: z.string().trim().max(40).nullable().default(null),
  name: z.string().trim().min(1, '每一行都要填写型号 / 规格').max(200, '型号 / 规格最多 200 个字'),
  dimensions: shortText(200),
  material: shortText(400),
  packing: shortText(300),
  unit: shortText(20),
  note: shortText(300),
  quantity: z.coerce.number().int('数量必须是整数').min(1, '数量至少为 1').max(100_000, '数量过大'),
  cbm: z.coerce.number().min(0, 'CBM 不能为负').max(100, 'CBM 过大').default(0),
  grossWeightKg: z.coerce.number().min(0, '毛重不能为负').max(100_000, '毛重过大').default(0),
  unitPrice: money('单价'),
  priceSource: z.enum(['LIST', 'LAST_QUOTE', 'MANUAL']).default('MANUAL'),
  listPrice: z.coerce.number().min(0).max(10_000_000).nullable().default(null),
});

const quoteInput = z.object({
  customerId: z.string().trim().min(1, '请选择客户'),
  currency: z.enum(QUOTE_CURRENCIES, { errorMap: () => ({ message: '请选择币种' }) }),
  language: z.enum(QUOTE_LANGUAGES).optional(),
  incoterm: z.enum(QUOTE_INCOTERMS, { errorMap: () => ({ message: '请选择贸易条款' }) }),
  incotermPlace: shortText(120),
  quoteDate: businessDate,
  validUntil: businessDate,
  destination: shortText(120),
  buyer: z.object({ company: shortText(200), attn: shortText(120), email: shortText(200), phone: shortText(120), address: shortText(300) }),
  terms: z.object({
    paymentTerms: shortText(400), leadTime: shortText(400), moq: shortText(400), packing: shortText(400),
    warranty: shortText(400), priceBasis: shortText(400), notes: shortText(4000),
  }),
  freight: z.object({
    rateId: z.string().trim().max(40).nullable().default(null),
    amount: money('运费'),
    manual: z.boolean().default(false),
  }).nullable().default(null),
  otherAmount: money('其他费用').default(0),
  remark: shortText(2000),
  items: z.array(lineInput).min(1, '至少添加一个产品').max(100, '一份报价最多 100 行'),
}).superRefine((v, ctx) => {
  if (v.validUntil < v.quoteDate) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: '有效期不能早于报价日期' });
});

const updateInput = quoteInput.and(z.object({ expectedUpdatedAt: z.string().datetime({ offset: true, message: '缺少版本信息，请刷新后重试' }) }));

const listQuery = z.object({
  q: z.string().trim().max(80).default(''),
  status: z.enum(['ALL', 'DRAFT', 'SENT']).default('ALL'),
  customerId: z.string().trim().max(40).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const builderQuery = z.object({
  customerId: z.string().trim().max(40).default(''),
  from: z.string().trim().max(40).default(''),
  edit: z.string().trim().max(40).default(''),
  product: z.string().trim().max(40).default(''),
  // From a chat: "Y-615:50,Y-601:20" (model:quantity), as the AI draft found them in the conversation.
  items: z.string().trim().max(500).default(''),
});

/** Catalog lines for "model:quantity" pairs: the first (smallest) size of each model; unknown models are reported. */
function prefillFrom(items: string, catalog: CatalogVariant[]) {
  const prefill: { variantId: string; quantity: number }[] = [], missing: string[] = [];
  for (const pair of items.split(',').map(p => p.trim()).filter(Boolean).slice(0, 10)) {
    const [model, qty] = pair.split(':');
    const quantity = Math.min(1_000_000, Math.max(1, Math.round(Number(qty)) || 1));
    const variant = catalog.find(v => v.model.toLowerCase() === model.trim().toLowerCase());
    if (variant) prefill.push({ variantId: variant.variantId, quantity }); else missing.push(model.trim());
  }
  return { prefill, prefillMissing: missing };
}

// ───────────────────────── 单据快照 ─────────────────────────

export type QuoteBuyer = { company: string; attn: string; email: string; phone: string; address: string };
export type QuoteTerms = { paymentTerms: string; leadTime: string; moq: string; packing: string; warranty: string; priceBasis: string; notes: string };
export type QuoteHeader = Pick<QuoteTemplateText, 'title' | 'companyLine' | 'contactLine' | 'footer' | 'preparedByRole'>;
export type FreightSnapshot = {
  rateId: string | null;
  mode: string;
  incoterm: string;
  basis: FreightBasis;
  rate: number;
  rateCurrency: string;
  chargeableQty: number;
  volumetricKg: number | null;
  fxFactor: number | null;
  computedAmount: number | null;
  manual: boolean;
};

type DocumentSnapshot = {
  v: 1;
  incotermPlace: string;
  quoteDate: string;
  validUntil: string;
  header: QuoteHeader;
  preparedBy: string;
  buyer: QuoteBuyer;
  terms: QuoteTerms;
  freight: FreightSnapshot | null;
};

/** 报价单渲染所需的全部数据；构建器实时预览与已保存单据共用同一结构。 */
export type QuoteDocumentData = {
  quoteNumber: string;
  language: QuoteLanguage;
  currency: string;
  incoterm: string;
  incotermPlace: string;
  quoteDate: string;
  validUntil: string;
  destination: string;
  header: QuoteHeader;
  preparedBy: string;
  buyer: QuoteBuyer;
  terms: QuoteTerms;
  items: { name: string; dimensions: string; material: string; packing: string; unit: string; note: string; quantity: number; cbm: number; grossWeightKg: number; unitPrice: number; amount: number; image: string | null }[];
  totals: { totalQuantity: number; totalCbm: number; totalGrossWeightKg: number; subtotal: number; freight: number; other: number; total: number };
  freight: { mode: string; incoterm: string } | null;
};

function parseSnapshot(raw: string | null): DocumentSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.v === 1 ? (parsed as DocumentSnapshot) : null;
  } catch {
    return null;
  }
}

// ───────────────────────── 产品目录（报价选型用） ─────────────────────────

const normalizeSize = (value: string) => value.replace(/\*/g, '×').replace(/\s*×\s*/g, '×').trim();

function variantDims(v: {
  lengthCm: number | null; widthCm: number | null; heightCm: number | null;
  secondaryLengthCm: number | null; secondaryWidthCm: number | null; secondaryHeightCm: number | null; bedSizeCm: string;
}, language: QuoteLanguage) {
  if (!v.lengthCm || !v.widthCm) return '';
  const labels = QUOTE_LABELS[language];
  // 资料只给长 × 宽时（如智能电动床垫未给厚度）只写两项
  const main = v.heightCm ? `${v.lengthCm}×${v.widthCm}×${v.heightCm}` : `${v.lengthCm}×${v.widthCm}`;
  if (v.secondaryLengthCm && v.secondaryWidthCm && v.secondaryHeightCm) {
    return `${main} / ${labels.inner} ${v.secondaryLengthCm}×${v.secondaryWidthCm}×${v.secondaryHeightCm}`;
  }
  if (v.bedSizeCm) return `${main} / ${labels.bedSize} ${normalizeSize(v.bedSizeCm)}`;
  return main;
}

function materialText(materials: { nameEn: string; nameCn: string }[], language: QuoteLanguage) {
  const english = materials.map(m => m.nameEn).filter(Boolean);
  const chinese = materials.map(m => m.nameCn).filter(Boolean);
  if (language === 'zh' && chinese.length === materials.length && chinese.length) return chinese.join(' + ');
  return english.length ? english.join(' + ') : chinese.join(' + ');
}

export type CatalogVariant = {
  variantId: string;
  productId: string;
  model: string;
  category: string;
  label: string;
  names: Record<QuoteLanguage, string>;
  dims: Record<QuoteLanguage, string>;
  material: Record<QuoteLanguage, string>;
  packing: string;
  cbm: number;
  grossWeightKg: number;
  image: string | null;
  prices: Partial<Record<string, number>>;
  /** 仅管理员：人民币成本（工厂成本优先，否则外购成本） */
  costCny?: number | null;
};

async function quoteCatalog(user: Actor): Promise<CatalogVariant[]> {
  const admin = user.role === 'ADMIN';
  const variants = await db.productVariant.findMany({
    where: { deletedAt: null, status: 'ACTIVE', product: { deletedAt: null, status: 'ACTIVE' } },
    select: {
      id: true, labelEn: true, labelCn: true, lengthCm: true, widthCm: true, heightCm: true,
      secondaryLengthCm: true, secondaryWidthCm: true, secondaryHeightCm: true, bedSizeCm: true,
      packingRaw: true, cbm: true, grossWeightKg: true,
      media: { orderBy: { sort: 'asc' }, take: 1, select: { storageKey: true } },
      prices: { where: { status: 'ACTIVE', customerTier: 'ALL' }, orderBy: { minQty: 'asc' }, select: { currency: true, unitPrice: true } },
      costs: { where: { status: 'ACTIVE' }, orderBy: { effectiveFrom: 'desc' }, take: 1, select: { factoryCost: true, purchaseCost: true } },
      product: {
        select: {
          id: true, model: true,
          category: { select: { nameCn: true, nameEn: true } },
          materials: { orderBy: { sort: 'asc' }, select: { nameEn: true, nameCn: true } },
          media: { where: { role: 'HERO' }, orderBy: { sort: 'asc' }, take: 1, select: { storageKey: true } },
        },
      },
    },
    orderBy: [{ product: { model: 'asc' } }, { cbm: 'asc' }],
  });

  return variants.map(v => {
    const prices: Partial<Record<string, number>> = {};
    for (const price of v.prices) if (prices[price.currency] === undefined) prices[price.currency] = Number(price.unitPrice.toFixed(2));
    const dims = { zh: variantDims(v, 'zh'), en: variantDims(v, 'en'), fr: variantDims(v, 'fr') };
    const nameFor = (language: QuoteLanguage) => (dims[language] ? `${v.product.model} | ${dims[language].split(' / ')[0]}` : v.product.model);
    const row: CatalogVariant = {
      variantId: v.id,
      productId: v.product.id,
      model: v.product.model,
      category: v.product.category.nameCn || v.product.category.nameEn,
      label: [v.labelCn, v.labelEn].filter(Boolean).join(' ').trim(),
      names: { zh: nameFor('zh'), en: nameFor('en'), fr: nameFor('fr') },
      dims,
      material: {
        zh: materialText(v.product.materials, 'zh'),
        en: materialText(v.product.materials, 'en'),
        fr: materialText(v.product.materials, 'fr'),
      },
      packing: normalizeSize(v.packingRaw),
      cbm: Number(v.cbm.toFixed(4)),
      grossWeightKg: Number(v.grossWeightKg.toFixed(2)),
      image: v.media[0]?.storageKey ?? v.product.media[0]?.storageKey ?? null,
      prices,
    };
    // 成本只给管理员：销售的返回值里连这个字段都没有
    if (admin) {
      const value = v.costs[0]?.factoryCost ?? v.costs[0]?.purchaseCost ?? null;
      row.costCny = value === null ? null : Number(value.toFixed(2));
    }
    return row;
  });
}

// ───────────────────────── 客户 ─────────────────────────

const customerSelect = {
  id: true, name: true, companyName: true, country: true, city: true, email: true, whatsapp: true, phone: true, currency: true,
  shippingCountry: true, shippingCity: true, shippingPostalCode: true, purchaseType: true,
  _count: { select: { quotations: true } },
} as const;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof customerSelect }>;

export type QuoteCustomer = ReturnType<typeof customerOption>;

function customerOption(c: CustomerRow) {
  const address = [c.shippingCity || c.city, c.shippingPostalCode, c.shippingCountry || c.country].filter(Boolean).join(', ');
  return {
    id: c.id,
    name: c.name,
    companyName: c.companyName,
    country: c.shippingCountry || c.country,
    email: c.email,
    phone: c.whatsapp || c.phone,
    currency: c.currency,
    address,
    purchaseType: c.purchaseType,
    quoteCount: c._count.quotations,
  };
}

export async function searchQuoteCustomers(user: Actor, input: unknown = {}) {
  const { q } = z.object({ q: z.string().trim().max(80).default('') }).parse(input);
  const rows = await db.customer.findMany({
    where: {
      ...scope(user),
      ...(q ? { OR: [{ name: { contains: q } }, { companyName: { contains: q } }, { whatsapp: { contains: q } }, { email: { contains: q } }, { country: { contains: q } }] } : {}),
    },
    select: customerSelect,
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: 20,
  });
  return rows.map(customerOption);
}

export type PriceHistoryRow = {
  quoteId: string;
  quoteNumber: string;
  status: string;
  date: string;
  variantId: string | null;
  name: string;
  currency: string;
  unitPrice: number;
  quantity: number;
};

/** 该客户报过的价格（最新在前）。excludeQuoteId 用于编辑时排除当前这份。 */
export async function customerPriceHistory(user: Actor, input: unknown): Promise<PriceHistoryRow[]> {
  const { customerId, excludeQuoteId } = z.object({ customerId: z.string().trim().min(1), excludeQuoteId: z.string().trim().max(40).default('') }).parse(input);
  await accessible(customerId, user);
  const timezone = await businessTimezone();
  const items = await db.quotationItem.findMany({
    where: { quotation: { customerId, ...(excludeQuoteId ? { id: { not: excludeQuoteId } } : {}) } },
    select: {
      variantId: true, name: true, unitPrice: true, quantity: true,
      quotation: { select: { id: true, quoteNumber: true, status: true, currency: true, quoteDate: true, createdAt: true } },
    },
    orderBy: [{ quotation: { createdAt: 'desc' } }, { sort: 'asc' }],
    take: 300,
  });
  return items.map(item => ({
    quoteId: item.quotation.id,
    quoteNumber: item.quotation.quoteNumber,
    status: item.quotation.status,
    date: dayKey(item.quotation.quoteDate ?? item.quotation.createdAt, timezone),
    variantId: item.variantId,
    name: item.name,
    currency: item.quotation.currency,
    unitPrice: Number(item.unitPrice.toFixed(2)),
    quantity: item.quantity,
  }));
}

async function businessTimezone() {
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  return setting.timezone;
}

// ───────────────────────── 构建器启动数据 ─────────────────────────

export type BuilderLine = z.input<typeof lineInput> & { key: string; image: string | null };
export type BuilderDraft = {
  customerId: string;
  currency: string;
  language: QuoteLanguage;
  incoterm: string;
  incotermPlace: string;
  quoteDate: string;
  validUntil: string;
  destination: string;
  buyer: QuoteBuyer;
  terms: QuoteTerms;
  freight: { rateId: string | null; amount: number; manual: boolean } | null;
  otherAmount: number;
  remark: string;
  items: BuilderLine[];
};

export async function quoteBuilderData(user: Actor, input: unknown = {}) {
  const query = builderQuery.parse(input);
  const timezone = await businessTimezone();
  const [catalog, freightRates, templates, fx] = await Promise.all([
    quoteCatalog(user),
    listFreightRates(user),
    quoteTemplates(),
    quoteFxRates(),
  ]);

  // 编辑草稿或复制旧单：把已保存的报价还原成构建器状态
  const sourceId = query.edit || query.from;
  let draft: BuilderDraft | null = null;
  let editing: { id: string; quoteNumber: string; updatedAt: string } | null = null;
  if (sourceId) {
    const source = await db.quotation.findFirst({
      where: { id: sourceId, customer: scope(user) },
      include: { items: { orderBy: { sort: 'asc' } } },
    });
    if (!source) throw new HttpError(404, '报价不存在或无权查看');
    if (query.edit && source.status !== 'DRAFT') throw new HttpError(409, '已登记发送的报价不能修改，请复制为新报价');
    draft = draftFromQuote(source, query.edit ? null : dayKey(new Date(), timezone), templates);
    if (query.edit) editing = { id: source.id, quoteNumber: source.quoteNumber, updatedAt: source.updatedAt.toISOString() };
  }

  const customerId = draft?.customerId || query.customerId;
  let customer: QuoteCustomer | null = null;
  if (customerId) {
    const row = await db.customer.findFirst({ where: { id: customerId, ...scope(user) }, select: customerSelect });
    customer = row ? customerOption(row) : null;
  }
  const history = customer ? await customerPriceHistory(user, { customerId: customer.id, excludeQuoteId: editing?.id ?? '' }) : [];
  const initialProduct = query.product ? catalog.find(v => v.productId === query.product)?.model ?? '' : '';

  return {
    today: dayKey(new Date(), timezone),
    timezone,
    preparedBy: user.name,
    isAdmin: user.role === 'ADMIN',
    catalog,
    freightRates,
    templates,
    fx,
    customer,
    history,
    draft,
    editing,
    initialProduct,
    ...(draft ? { prefill: [], prefillMissing: [] } : prefillFrom(query.items, catalog)),
  };
}

export type QuoteBuilderData = Awaited<ReturnType<typeof quoteBuilderData>>;

type QuoteWithItems = Prisma.QuotationGetPayload<{ include: { items: true } }>;

function draftFromQuote(q: QuoteWithItems, today: string | null, templates: Awaited<ReturnType<typeof quoteTemplates>>): BuilderDraft {
  const snapshot = parseSnapshot(q.documentJson);
  const language = (QUOTE_LANGUAGES as readonly string[]).includes(q.language) ? (q.language as QuoteLanguage) : languageForCurrency(q.currency);
  const template = templates[language];
  const validDays = template.validDays;
  const quoteDate = today ?? snapshot?.quoteDate ?? '';
  const items: BuilderLine[] = q.items.length
    ? q.items.map((item, index) => ({
        key: `${index}-${item.id}`,
        variantId: item.variantId,
        name: item.name,
        dimensions: item.dimensions,
        material: item.material,
        packing: item.packing,
        unit: item.unit,
        note: item.note,
        quantity: item.quantity,
        cbm: Number(item.cbm),
        grossWeightKg: Number(item.grossWeightKg),
        unitPrice: Number(item.unitPrice),
        priceSource: today ? 'LAST_QUOTE' : (item.priceSource as 'LIST' | 'LAST_QUOTE' | 'MANUAL'),
        listPrice: item.listPrice === null ? null : Number(item.listPrice),
        image: item.imageKey,
      }))
    : [{
        key: 'legacy', variantId: null, name: q.product, dimensions: '', material: '', packing: '', unit: template.unitLabel, note: '',
        quantity: q.quantity, cbm: 0, grossWeightKg: 0, unitPrice: Number(q.unitPrice), priceSource: 'MANUAL', listPrice: null, image: null,
      }];
  return {
    customerId: q.customerId,
    currency: q.currency,
    language,
    incoterm: (QUOTE_INCOTERMS as readonly string[]).includes(q.incoterm) ? q.incoterm : 'FOB',
    incotermPlace: snapshot?.incotermPlace ?? '',
    quoteDate,
    validUntil: today ? addDays(today, validDays) : snapshot?.validUntil ?? quoteDate,
    destination: q.destination,
    buyer: snapshot?.buyer ?? { company: '', attn: '', email: '', phone: '', address: '' },
    terms: snapshot?.terms ?? {
      paymentTerms: template.paymentTerms, leadTime: template.leadTime, moq: template.moq, packing: template.packing,
      warranty: template.warranty, priceBasis: template.priceBasis, notes: template.notes,
    },
    freight: snapshot?.freight
      ? { rateId: snapshot.freight.rateId, amount: Number(q.freightAmount ?? 0), manual: snapshot.freight.manual }
      : q.freightAmount && Number(q.freightAmount) > 0 ? { rateId: null, amount: Number(q.freightAmount), manual: true } : null,
    otherAmount: Number(q.otherAmount ?? 0),
    remark: q.notes,
    items,
  };
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ───────────────────────── 保存 ─────────────────────────

type ParsedQuote = z.infer<typeof quoteInput>;

/** 服务端重算：行金额、合计、运费（按运费库，除非业务员手动改过运费）。 */
async function prepare(v: ParsedQuote, user: Actor) {
  await accessible(v.customerId, user);
  const language = v.language ?? languageForCurrency(v.currency);

  // 产品行：校验规格存在，图片与型号以产品库为准
  const variantIds = [...new Set(v.items.map(item => item.variantId).filter((id): id is string => Boolean(id)))];
  const variants = variantIds.length
    ? await db.productVariant.findMany({
        where: { id: { in: variantIds }, deletedAt: null },
        select: {
          id: true, productId: true,
          media: { orderBy: { sort: 'asc' }, take: 1, select: { storageKey: true } },
          product: { select: { model: true, media: { where: { role: 'HERO' }, orderBy: { sort: 'asc' }, take: 1, select: { storageKey: true } } } },
        },
      })
    : [];
  const byId = new Map(variants.map(variant => [variant.id, variant]));
  for (const id of variantIds) if (!byId.has(id)) throw new HttpError(400, '报价里有产品规格已下架或不存在，请删除该行后重试');

  const preTotals = computeTotals(v.items, 0, 0);
  let freightAmount = 0;
  let freight: FreightSnapshot | null = null;
  if (v.freight) {
    let result: FreightResult | null = null;
    let rate: Awaited<ReturnType<typeof db.freightRate.findUnique>> = null;
    if (v.freight.rateId) {
      rate = await db.freightRate.findUnique({ where: { id: v.freight.rateId } });
      if (!rate) throw new HttpError(400, '所选运价已不存在，请重新选择运费');
      const fx = await quoteFxRates();
      result = computeFreight(
        { basis: rate.basis as FreightBasis, rate: Number(rate.rate), currency: rate.currency, volumetricKgPerCbm: rate.volumetricKgPerCbm, minChargeQty: rate.minChargeQty === null ? null : Number(rate.minChargeQty) },
        { cbm: preTotals.totalCbm, grossWeightKg: preTotals.totalGrossWeightKg },
        v.currency,
        fx,
      );
    }
    if (v.freight.manual || !result) {
      freightAmount = v.freight.amount;
    } else {
      if (result.amount === null) throw new HttpError(400, `缺少 ${rate!.currency} 与 ${v.currency} 的汇率，无法换算运费；请在报价设置填写汇率，或手动填写运费`);
      freightAmount = result.amount;
    }
    freight = rate && result
      ? {
          rateId: rate.id, mode: rate.mode, incoterm: rate.incoterm, basis: rate.basis as FreightBasis, rate: Number(rate.rate), rateCurrency: rate.currency,
          chargeableQty: result.chargeableQty, volumetricKg: result.volumetricKg, fxFactor: result.fxFactor, computedAmount: result.amount, manual: v.freight.manual,
        }
      : { rateId: null, mode: '', incoterm: v.incoterm, basis: 'SHIPMENT', rate: freightAmount, rateCurrency: v.currency, chargeableQty: 1, volumetricKg: null, fxFactor: 1, computedAmount: null, manual: true };
  }

  const totals = computeTotals(v.items, freightAmount, v.otherAmount);
  if (totals.total > 1_000_000_000_000) throw new HttpError(400, '报价总额过大');
  const templates = await quoteTemplates();
  const template = templates[language];
  const snapshot: DocumentSnapshot = {
    v: 1,
    incotermPlace: v.incotermPlace,
    quoteDate: v.quoteDate,
    validUntil: v.validUntil,
    header: { title: template.title, companyLine: template.companyLine, contactLine: template.contactLine, footer: template.footer, preparedByRole: template.preparedByRole },
    preparedBy: user.name,
    buyer: v.buyer,
    terms: v.terms,
    freight,
  };
  const timezone = await businessTimezone();
  const first = v.items[0].name;
  const summary = v.items.length > 1 ? `${first} 等 ${v.items.length} 项` : first;

  const quoteData = {
    product: summary.slice(0, 180),
    quantity: totals.totalQuantity,
    // 多行报价没有单一单价：存均价仅作旧读取方兜底，金额以 totalAmount 为准
    unitPrice: new Prisma.Decimal(round2(totals.total / totals.totalQuantity).toFixed(2)),
    currency: v.currency,
    incoterm: v.incoterm,
    notes: v.remark,
    language,
    quoteDate: localDate(`${v.quoteDate}T00:00:00`, timezone),
    validUntil: localDate(`${v.validUntil}T00:00:00`, timezone),
    subtotalAmount: new Prisma.Decimal(totals.subtotal.toFixed(2)),
    freightAmount: v.freight ? new Prisma.Decimal(totals.freight.toFixed(2)) : null,
    otherAmount: new Prisma.Decimal(totals.other.toFixed(2)),
    totalAmount: new Prisma.Decimal(totals.total.toFixed(2)),
    totalQuantity: totals.totalQuantity,
    totalCbm: new Prisma.Decimal(totals.totalCbm.toFixed(4)),
    totalGrossWeightKg: new Prisma.Decimal(totals.totalGrossWeightKg.toFixed(2)),
    destination: v.destination,
    freightRateId: freight?.rateId ?? null,
    documentJson: JSON.stringify(snapshot),
  };
  const items = v.items.map((item, index) => {
    const variant = item.variantId ? byId.get(item.variantId) : undefined;
    return {
      sort: index,
      productId: variant?.productId ?? null,
      variantId: item.variantId,
      model: variant?.product.model ?? item.name.split('|')[0].trim().slice(0, 80),
      name: item.name,
      dimensions: item.dimensions,
      material: item.material,
      packing: item.packing,
      unit: item.unit || template.unitLabel,
      imageKey: variant ? variant.media[0]?.storageKey ?? variant.product.media[0]?.storageKey ?? null : null,
      note: item.note,
      quantity: item.quantity,
      cbm: new Prisma.Decimal(item.cbm.toFixed(4)),
      grossWeightKg: new Prisma.Decimal(item.grossWeightKg.toFixed(2)),
      unitPrice: new Prisma.Decimal(item.unitPrice.toFixed(2)),
      amount: new Prisma.Decimal(totals.lines[index].toFixed(2)),
      listPrice: item.listPrice === null ? null : new Prisma.Decimal(item.listPrice.toFixed(2)),
      // 单价来源由构建器标记：沿用建议价为 LIST / LAST_QUOTE，业务员改过即为 MANUAL（内部参考）
      priceSource: item.priceSource,
    };
  });
  return { quoteData, items, timezone };
}

async function nextQuoteNumber(tx: Prisma.TransactionClient, yearMonth: string) {
  const prefix = `${QUOTE_PREFIX}-${yearMonth}-`;
  const existing = await tx.quotation.findMany({ where: { quoteNumber: { startsWith: prefix } }, select: { quoteNumber: true } });
  const max = existing.reduce((best, row) => {
    const n = Number(row.quoteNumber.slice(prefix.length));
    return Number.isInteger(n) && n > best ? n : best;
  }, 0);
  return quoteNumberFor(QUOTE_PREFIX, yearMonth, max + 1);
}

export async function createItemizedQuote(input: unknown, user: Actor) {
  const v = quoteInput.parse(input);
  const { quoteData, items, timezone } = await prepare(v, user);
  const yearMonth = dayKey(new Date(), timezone).slice(0, 7).replace('-', '');
  // 编号按月流水；两人同时保存撞号时唯一约束会拒绝，重新取号即可
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await retryTransaction(() => db.$transaction(async tx => {
        const quoteNumber = await nextQuoteNumber(tx, yearMonth);
        return tx.quotation.create({
          data: { ...quoteData, customerId: v.customerId, quoteNumber, status: 'DRAFT', createdBy: user.id, items: { create: items } },
          select: { id: true, quoteNumber: true, status: true, updatedAt: true },
        });
      }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && attempt < 4) continue;
      throw error;
    }
  }
  throw new HttpError(409, '报价编号生成冲突，请重试');
}

/** 只能修改草稿；已登记发送的报价请复制为新报价，保证发给客户的版本不被改动。 */
export async function updateItemizedQuote(id: string, input: unknown, user: Actor) {
  const parsed = updateInput.parse(input);
  const { expectedUpdatedAt, ...v } = parsed;
  const current = await db.quotation.findFirst({ where: { id, customer: scope(user) }, select: { id: true, status: true, customerId: true } });
  if (!current) throw new HttpError(404, '报价不存在或无权查看');
  if (current.status !== 'DRAFT') throw new HttpError(409, '已登记发送的报价不能修改，请复制为新报价');
  if (current.customerId !== v.customerId) throw new HttpError(400, '报价单不能改挂到其他客户，请复制为新报价');
  const { quoteData, items } = await prepare(v, user);
  return retryTransaction(() => db.$transaction(async tx => {
    const updated = await tx.quotation.updateMany({ where: { id, status: 'DRAFT', updatedAt: new Date(expectedUpdatedAt) }, data: quoteData });
    if (!updated.count) throw new HttpError(409, '这份报价刚被修改或已登记发送，请刷新后再改');
    await tx.quotationItem.deleteMany({ where: { quotationId: id } });
    await tx.quotationItem.createMany({ data: items.map(item => ({ ...item, quotationId: id })) });
    return tx.quotation.findUniqueOrThrow({ where: { id }, select: { id: true, quoteNumber: true, status: true, updatedAt: true } });
  }));
}

// ───────────────────────── 查看 ─────────────────────────

export async function quoteDetail(user: Actor, id: string) {
  const quote = await db.quotation.findFirst({
    where: { id, customer: scope(user) },
    include: {
      items: { orderBy: { sort: 'asc' } },
      customer: { select: { id: true, name: true, companyName: true, country: true, city: true, email: true, whatsapp: true, phone: true, shippingCountry: true, shippingCity: true, shippingPostalCode: true } },
    },
  });
  if (!quote) throw new HttpError(404, '报价不存在或无权查看');
  const [templates, timezone, creator] = await Promise.all([
    quoteTemplates(),
    businessTimezone(),
    db.user.findUnique({ where: { id: quote.createdBy }, select: { name: true } }),
  ]);
  const snapshot = parseSnapshot(quote.documentJson);
  const language = (QUOTE_LANGUAGES as readonly string[]).includes(quote.language) ? (quote.language as QuoteLanguage) : 'en';
  const template = templates[language];
  const c = quote.customer;
  const created = dayKey(quote.createdAt, timezone);

  const items = quote.items.length
    ? quote.items.map(item => ({
        name: item.name, dimensions: item.dimensions, material: item.material, packing: item.packing, unit: item.unit, note: item.note,
        quantity: item.quantity, cbm: Number(item.cbm), grossWeightKg: Number(item.grossWeightKg), unitPrice: Number(item.unitPrice), amount: Number(item.amount), image: item.imageKey,
        variantId: item.variantId, priceSource: item.priceSource, listPrice: item.listPrice === null ? null : Number(item.listPrice),
      }))
    : [{
        name: quote.product, dimensions: '', material: '', packing: '', unit: template.unitLabel, note: '', quantity: quote.quantity, cbm: 0, grossWeightKg: 0,
        unitPrice: Number(quote.unitPrice), amount: Number(quote.unitPrice.mul(quote.quantity)), image: null, variantId: null, priceSource: 'MANUAL', listPrice: null,
      }];
  const amount = Number(quotationAmount(quote));
  const document: QuoteDocumentData = {
    quoteNumber: quote.quoteNumber,
    language,
    currency: quote.currency,
    incoterm: quote.incoterm,
    incotermPlace: snapshot?.incotermPlace ?? '',
    quoteDate: snapshot?.quoteDate ?? created,
    validUntil: snapshot?.validUntil ?? addDays(created, template.validDays),
    destination: quote.destination,
    header: snapshot?.header ?? { title: template.title, companyLine: template.companyLine, contactLine: template.contactLine, footer: template.footer, preparedByRole: template.preparedByRole },
    preparedBy: snapshot?.preparedBy ?? creator?.name ?? '',
    buyer: snapshot?.buyer ?? {
      company: c.companyName, attn: c.name, email: c.email, phone: c.whatsapp || c.phone,
      address: [c.shippingCity || c.city, c.shippingPostalCode, c.shippingCountry || c.country].filter(Boolean).join(', '),
    },
    terms: snapshot?.terms ?? {
      paymentTerms: template.paymentTerms, leadTime: template.leadTime, moq: template.moq, packing: template.packing,
      warranty: template.warranty, priceBasis: template.priceBasis, notes: quote.notes || template.notes,
    },
    items,
    totals: {
      totalQuantity: quote.totalQuantity ?? quote.quantity,
      totalCbm: Number(quote.totalCbm ?? 0),
      totalGrossWeightKg: Number(quote.totalGrossWeightKg ?? 0),
      subtotal: Number(quote.subtotalAmount ?? amount),
      freight: Number(quote.freightAmount ?? 0),
      other: Number(quote.otherAmount ?? 0),
      total: amount,
    },
    freight: snapshot?.freight ? { mode: snapshot.freight.mode, incoterm: snapshot.freight.incoterm } : null,
  };

  return {
    id: quote.id,
    status: quote.status,
    sentAt: quote.sentAt?.toISOString() ?? null,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    itemized: quote.items.length > 0,
    remark: snapshot ? quote.notes : '',
    creatorName: creator?.name ?? '',
    customer: { id: c.id, name: c.name, companyName: c.companyName, country: c.shippingCountry || c.country },
    freightDetail: snapshot?.freight ?? null,
    // 单价来源与报价当时的价格表价：内部参考，不进入单据
    priceSources: items.map(item => ({ priceSource: item.priceSource, listPrice: item.listPrice })),
    document,
  };
}

export type QuoteDetail = Awaited<ReturnType<typeof quoteDetail>>;

export async function quoteList(user: Actor, input: unknown = {}) {
  const query = listQuery.parse(input);
  const where: Prisma.QuotationWhereInput = {
    customer: scope(user),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.status === 'ALL' ? {} : { status: query.status }),
    ...(query.q
      ? { OR: [{ quoteNumber: { contains: query.q } }, { product: { contains: query.q } }, { customer: { name: { contains: query.q } } }, { customer: { companyName: { contains: query.q } } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.quotation.findMany({
      where,
      select: {
        id: true, quoteNumber: true, status: true, product: true, quantity: true, unitPrice: true, totalAmount: true, currency: true, language: true,
        incoterm: true, destination: true, createdAt: true, sentAt: true, createdBy: true,
        customer: { select: { id: true, name: true, companyName: true, country: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
    }),
    db.quotation.count({ where }),
  ]);
  const creators = await db.user.findMany({ where: { id: { in: [...new Set(rows.map(r => r.createdBy))] } }, select: { id: true, name: true } });
  return {
    query,
    total,
    pageSize: LIST_PAGE_SIZE,
    rows: rows.map(row => ({
      id: row.id,
      quoteNumber: row.quoteNumber,
      status: row.status,
      product: row.product,
      itemCount: row._count.items,
      itemized: row._count.items > 0,
      quantity: row.quantity,
      amount: quotationAmount(row).toFixed(2),
      currency: row.currency,
      language: row.language,
      incoterm: row.incoterm,
      destination: row.destination,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      creatorName: creators.find(u => u.id === row.createdBy)?.name ?? '',
      customer: row.customer,
    })),
  };
}

export type QuoteList = Awaited<ReturnType<typeof quoteList>>;
