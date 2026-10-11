import { FORTY_HQ_CBM } from './product-packing';

/**
 * 报价计算（纯函数，前端实时预览与服务端保存共用同一份实现，保证两边金额一致）。
 *
 * 口径：
 *   - 金额按「分」整数运算：行金额 = 单价(分) × 数量，产品小计为行金额之和
 *   - 运费 = 计费量 × 运价 × 汇率，最后一次性四舍五入到分
 *   - 报价总额 = 产品小计 + 运费 + 其他费用
 *   - 汇率统一以「1 外币 = 多少人民币」表示；缺少汇率时不折算，返回 null 交给人工填写
 */

export const QUOTE_CURRENCIES = ['CNY', 'USD', 'EUR'] as const;
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number];
export const QUOTE_LANGUAGES = ['zh', 'en', 'fr'] as const;
export type QuoteLanguage = (typeof QUOTE_LANGUAGES)[number];
export const QUOTE_INCOTERMS = ['EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'] as const;
export const FREIGHT_MODES = ['SEA', 'AIR', 'EXPRESS', 'RAIL', 'TRUCK'] as const;
export const FREIGHT_BASES = ['KG', 'CBM', 'CONTAINER_20GP', 'CONTAINER_40HQ', 'SHIPMENT'] as const;
export type FreightBasis = (typeof FREIGHT_BASES)[number];

/** 20GP 可用容积按 28 m³ 估算；40HQ 沿用产品库的 68 m³。 */
export const TWENTY_GP_CBM = 28;
export const CONTAINER_CBM: Record<'CONTAINER_20GP' | 'CONTAINER_40HQ', number> = {
  CONTAINER_20GP: TWENTY_GP_CBM,
  CONTAINER_40HQ: FORTY_HQ_CBM,
};

/** 人民币报价用中文单据，其他币种用英文单据；法文需要手动选择。 */
export function languageForCurrency(currency: string): QuoteLanguage {
  return currency === 'CNY' ? 'zh' : 'en';
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);

/** 1 单位该币种折合多少人民币；未知返回 null。 */
export type FxRates = { usdCny: number; eurCny: number | null };

export function cnyPer(currency: string, fx: FxRates): number | null {
  if (currency === 'CNY') return 1;
  if (currency === 'USD') return fx.usdCny > 0 ? fx.usdCny : null;
  if (currency === 'EUR') return fx.eurCny && fx.eurCny > 0 ? fx.eurCny : null;
  return null;
}

/** 币种换算的乘数；同币种为 1，缺汇率为 null。 */
export function fxFactor(from: string, to: string, fx: FxRates): number | null {
  if (from === to) return 1;
  const a = cnyPer(from, fx);
  const b = cnyPer(to, fx);
  return a === null || b === null ? null : a / b;
}

export function convert(amount: number, from: string, to: string, fx: FxRates): number | null {
  const factor = fxFactor(from, to, fx);
  return factor === null ? null : round2(amount * factor);
}

export type QuoteLineInput = { quantity: number; unitPrice: number; cbm: number; grossWeightKg: number };

export function lineAmount(line: Pick<QuoteLineInput, 'quantity' | 'unitPrice'>): number {
  return (toCents(line.unitPrice) * line.quantity) / 100;
}

export type FreightRateInput = {
  basis: FreightBasis;
  rate: number;
  currency: string;
  volumetricKgPerCbm: number | null;
  minChargeQty: number | null;
};

export type FreightResult = {
  /** 计费量，单位与计费方式一致（kg / CBM / 柜 / 票） */
  chargeableQty: number;
  /** 运价币种的运费 */
  amountInRateCurrency: number;
  /** 折算到报价币种的运费；缺汇率时为 null */
  amount: number | null;
  /** 按体积折算的重量（仅按公斤且设置了计泡系数时） */
  volumetricKg: number | null;
  fxFactor: number | null;
};

/** 计费量：按公斤取实重与体积重的较大值，再与最低计费量比较；按柜向上取整。 */
export function chargeableQuantity(rate: FreightRateInput, totals: { cbm: number; grossWeightKg: number }) {
  let qty: number;
  let volumetricKg: number | null = null;
  switch (rate.basis) {
    case 'KG':
      volumetricKg = rate.volumetricKgPerCbm ? round2(totals.cbm * rate.volumetricKgPerCbm) : null;
      qty = round2(Math.max(totals.grossWeightKg, volumetricKg ?? 0));
      break;
    case 'CBM':
      qty = round4(totals.cbm);
      break;
    case 'CONTAINER_20GP':
    case 'CONTAINER_40HQ':
      qty = totals.cbm > 0 ? Math.ceil(round4(totals.cbm) / CONTAINER_CBM[rate.basis]) : 0;
      break;
    case 'SHIPMENT':
      qty = 1;
      break;
  }
  if (rate.minChargeQty && qty > 0 && qty < rate.minChargeQty) qty = rate.minChargeQty;
  return { qty, volumetricKg };
}

export function computeFreight(
  rate: FreightRateInput,
  totals: { cbm: number; grossWeightKg: number },
  quoteCurrency: string,
  fx: FxRates,
): FreightResult {
  const { qty, volumetricKg } = chargeableQuantity(rate, totals);
  const raw = qty * rate.rate;
  const factor = fxFactor(rate.currency, quoteCurrency, fx);
  return {
    chargeableQty: qty,
    amountInRateCurrency: round2(raw),
    amount: factor === null ? null : round2(raw * factor),
    volumetricKg,
    fxFactor: factor,
  };
}

export type QuoteTotals = {
  lines: number[];
  totalQuantity: number;
  totalCbm: number;
  totalGrossWeightKg: number;
  subtotal: number;
  freight: number;
  other: number;
  total: number;
};

/** 汇总：数量、体积、毛重、产品小计与报价总额。 */
export function computeTotals(lines: QuoteLineInput[], freight: number, other: number): QuoteTotals {
  const lineCents = lines.map(line => toCents(line.unitPrice) * line.quantity);
  const subtotalCents = lineCents.reduce((sum, cents) => sum + cents, 0);
  const totalCents = subtotalCents + toCents(freight) + toCents(other);
  return {
    lines: lineCents.map(cents => cents / 100),
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalCbm: round4(lines.reduce((sum, line) => sum + line.cbm * line.quantity, 0)),
    totalGrossWeightKg: round2(lines.reduce((sum, line) => sum + line.grossWeightKg * line.quantity, 0)),
    subtotal: subtotalCents / 100,
    freight: round2(freight),
    other: round2(other),
    total: totalCents / 100,
  };
}

export type PriceSource = 'LIST' | 'LAST_QUOTE' | 'MANUAL';

export type LastQuotedPrice = { unitPrice: number; currency: string; quoteNumber: string; date: string };

export type PriceSuggestion = {
  price: number | null;
  source: PriceSource;
  /** 未经调价的价格表价（已按汇率折算到报价币种），内部参考 */
  listPrice: number | null;
  /** 给业务员看的来源说明，例如「上次报价 LVJ-202610-003（2026-10-08）」 */
  hint: string;
};

/**
 * 智能单价：
 *   1. 该客户以前用同币种报过这个规格 → 沿用上次报价，避免同一客户前后报价不一致
 *   2. 价格表有该币种 → 价格表价 ×（1 + 调价%）
 *   3. 价格表只有其他币种 → 按系统汇率折算后再调价
 *   4. 都没有 → 留空，由业务员填写
 */
export function suggestUnitPrice(args: {
  prices: Partial<Record<string, number>>;
  currency: string;
  fx: FxRates;
  adjustPct: number;
  lastQuote?: LastQuotedPrice | null;
}): PriceSuggestion {
  const { prices, currency, fx, adjustPct, lastQuote } = args;
  const direct = prices[currency];
  let listPrice: number | null = direct ?? null;
  let converted = '';
  if (listPrice === null) {
    for (const from of ['USD', 'CNY', 'EUR']) {
      const base = prices[from];
      if (base === undefined) continue;
      const value = convert(base, from, currency, fx);
      if (value !== null) {
        listPrice = value;
        converted = `${from} ${base.toFixed(2)} 按汇率折算`;
        break;
      }
    }
  }
  if (lastQuote && lastQuote.currency === currency) {
    return { price: lastQuote.unitPrice, source: 'LAST_QUOTE', listPrice, hint: `沿用上次报价 ${lastQuote.quoteNumber}（${lastQuote.date}）` };
  }
  if (listPrice === null) return { price: null, source: 'MANUAL', listPrice: null, hint: '价格表没有该币种价格，请手动填写' };
  const adjusted = round2(listPrice * (1 + adjustPct / 100));
  const adjustText = adjustPct ? `，调价 ${adjustPct > 0 ? '+' : ''}${adjustPct}%` : '';
  return { price: adjusted, source: 'LIST', listPrice, hint: `价格表${converted ? `（${converted}）` : ''}${adjustText}` };
}

/** 报价编号：LVJ-年月-三位流水，例如 LVJ-202610-001。 */
export function quoteNumberFor(prefix: string, yearMonth: string, sequence: number) {
  return `${prefix}-${yearMonth}-${String(sequence).padStart(3, '0')}`;
}

/** 毛利率（%）；售价为 0 或成本未知时返回 null。 */
export function marginPct(priceCny: number | null, costCny: number | null): number | null {
  if (priceCny === null || costCny === null || priceCny <= 0) return null;
  return Math.round(((priceCny - costCny) / priceCny) * 1000) / 10;
}
