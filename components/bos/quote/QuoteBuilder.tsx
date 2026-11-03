'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, RotateCcw, Save, Trash2, Truck, Eye, PencilLine } from 'lucide-react';
import { Header, Card, Badge, Button, Typography } from '@/components/ui/bos';
import { api } from '@/lib/client';
import type {
  BuilderDraft, CatalogVariant, PriceHistoryRow, QuoteBuilderData, QuoteBuyer, QuoteCustomer, QuoteDocumentData, QuoteTerms,
} from '@/services/itemized-quote-service';
import type { FreightRateView } from '@/services/freight-service';
import {
  QUOTE_CURRENCIES, QUOTE_INCOTERMS, QUOTE_LANGUAGES, cnyPer, computeFreight, computeTotals, convert, languageForCurrency, marginPct,
  suggestUnitPrice, type FreightBasis, type LastQuotedPrice, type PriceSource, type QuoteLanguage,
} from '@/lib/quote-math';
import { FREIGHT_BASIS_LABELS, FREIGHT_MODE_LABELS, LANGUAGE_NAMES, formatAmount } from '@/lib/quote-i18n';
import { CustomerPicker } from './CustomerPicker';
import { NumberField } from './NumberField';
import { ProductPicker } from './ProductPicker';
import { QuoteDocument } from './QuoteDocument';
import { ScaledPreview } from './ScaledPreview';

type Line = {
  key: string;
  variantId: string | null;
  name: string;
  dimensions: string;
  material: string;
  packing: string;
  unit: string;
  note: string;
  quantity: number;
  cbm: number;
  grossWeightKg: number;
  unitPrice: number | null;
  priceSource: PriceSource;
  listPrice: number | null;
  hint: string;
  image: string | null;
  /** 名称 / 尺寸 / 材质被手动改过后，切换语言不再覆盖 */
  textEdited: boolean;
};

type FreightChoice = { kind: 'none' } | { kind: 'rate'; rateId: string } | { kind: 'manual' };

const ADJUST_PRESETS = [-5, 0, 5, 10, 15, 20];
const CURRENCY_NAMES: Record<string, string> = { CNY: '人民币', USD: '美元', EUR: '欧元' };
const SOURCE_LABEL: Record<PriceSource, string> = { LIST: '价格表', LAST_QUOTE: '上次报价', MANUAL: '手动' };
const PLACEHOLDER_NUMBER: Record<QuoteLanguage, string> = { zh: '保存后生成', en: 'Assigned on save', fr: 'Attribué à l’enregistrement' };
const LOW_MARGIN = 15;
const PLACE_KEY = 'lvanju.quote.place.';

let lineSeq = 0;
const nextKey = () => `line-${Date.now().toString(36)}-${(lineSeq += 1)}`;

function lastQuoteMap(history: PriceHistoryRow[]) {
  const map = new Map<string, LastQuotedPrice>();
  for (const row of history) {
    if (!row.variantId) continue;
    const key = `${row.variantId}:${row.currency}`;
    if (!map.has(key)) map.set(key, { unitPrice: row.unitPrice, currency: row.currency, quoteNumber: row.quoteNumber, date: row.date });
  }
  return map;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buyerFrom(customer: QuoteCustomer | null): QuoteBuyer {
  return customer
    ? { company: customer.companyName, attn: customer.name, email: customer.email, phone: customer.phone, address: customer.address }
    : { company: '', attn: '', email: '', phone: '', address: '' };
}

function readStored(key: string) {
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* 隐私模式下忽略 */ }
}

export function QuoteBuilder({ data }: { data: QuoteBuilderData }) {
  const router = useRouter();
  const draft: BuilderDraft | null = data.draft;
  const catalogById = useMemo(() => new Map(data.catalog.map(v => [v.variantId, v])), [data.catalog]);
  const initialCurrency = draft?.currency ?? (data.customer && (QUOTE_CURRENCIES as readonly string[]).includes(data.customer.currency) ? data.customer.currency : 'USD');
  const initialLanguage = draft?.language ?? languageForCurrency(initialCurrency);
  const template = (language: QuoteLanguage) => data.templates[language];
  const templateTerms = (language: QuoteLanguage): QuoteTerms => {
    const t = template(language);
    return { paymentTerms: t.paymentTerms, leadTime: t.leadTime, moq: t.moq, packing: t.packing, warranty: t.warranty, priceBasis: t.priceBasis, notes: t.notes };
  };

  const [customer, setCustomer] = useState<QuoteCustomer | null>(data.customer);
  const [history, setHistory] = useState<PriceHistoryRow[]>(data.history);
  const [currency, setCurrency] = useState(initialCurrency);
  const [language, setLanguage] = useState<QuoteLanguage>(initialLanguage);
  const [languageTouched, setLanguageTouched] = useState(Boolean(draft));
  const [adjustPct, setAdjustPct] = useState(0);
  const [incoterm, setIncoterm] = useState(draft?.incoterm ?? 'FOB');
  const [incotermPlace, setIncotermPlace] = useState(draft?.incotermPlace ?? '');
  const [quoteDate, setQuoteDate] = useState(draft?.quoteDate ?? data.today);
  const [validUntil, setValidUntil] = useState(draft?.validUntil ?? addDays(data.today, template(initialLanguage).validDays));
  const [validTouched, setValidTouched] = useState(Boolean(draft));
  const [destination, setDestination] = useState(draft?.destination ?? data.customer?.country ?? '');
  const [freightChoice, setFreightChoice] = useState<FreightChoice>(() =>
    !draft?.freight ? { kind: 'none' } : draft.freight.rateId ? { kind: 'rate', rateId: draft.freight.rateId } : { kind: 'manual' });
  const [freightOverride, setFreightOverride] = useState<number | null>(draft?.freight?.manual ? draft.freight.amount : null);
  const [showAllRates, setShowAllRates] = useState(false);
  const [otherAmount, setOtherAmount] = useState(draft?.otherAmount ?? 0);
  const [buyer, setBuyer] = useState<QuoteBuyer>(draft?.buyer ?? buyerFrom(data.customer));
  const [terms, setTerms] = useState<QuoteTerms>(draft?.terms ?? templateTerms(initialLanguage));
  const [termsTouched, setTermsTouched] = useState(Boolean(draft));
  const [remark, setRemark] = useState(draft?.remark ?? '');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(() => !draft && (data.prefill.length || data.prefillMissing.length)
    ? `已按聊天带入 ${data.prefill.length} 个产品：请核对尺寸、数量和单价${data.prefillMissing.length ? `；产品库里没有 ${data.prefillMissing.join('、')}，需要手动添加` : ''}` : '');

  const lastQuotes = useMemo(() => lastQuoteMap(history), [history]);

  const suggestFor = (variant: CatalogVariant, opts: { currency: string; adjustPct: number; lastQuotes: Map<string, LastQuotedPrice> }) =>
    suggestUnitPrice({ prices: variant.prices, currency: opts.currency, fx: data.fx, adjustPct: opts.adjustPct, lastQuote: opts.lastQuotes.get(`${variant.variantId}:${opts.currency}`) ?? null });

  const lineFromVariant = (variant: CatalogVariant, lang: QuoteLanguage, quantity = 1): Line => {
    const s = suggestFor(variant, { currency, adjustPct, lastQuotes });
    return {
      key: nextKey(), variantId: variant.variantId, name: variant.names[lang], dimensions: variant.dims[lang], material: variant.material[lang],
      packing: variant.packing, unit: template(lang).unitLabel, note: '', quantity, cbm: variant.cbm, grossWeightKg: variant.grossWeightKg,
      unitPrice: s.price, priceSource: s.source, listPrice: s.listPrice, hint: s.hint, image: variant.image, textEdited: false,
    };
  };

  const [lines, setLines] = useState<Line[]>(() => !draft && data.prefill.length ? data.prefill.flatMap(item => {
    const variant = catalogById.get(item.variantId);
    return variant ? [lineFromVariant(variant, initialLanguage, item.quantity)] : [];
  }) : (draft?.items ?? []).map(item => ({
    key: item.key, variantId: item.variantId ?? null, name: item.name, dimensions: item.dimensions ?? '', material: item.material ?? '',
    packing: item.packing ?? '', unit: item.unit ?? '', note: item.note ?? '', quantity: Number(item.quantity), cbm: Number(item.cbm ?? 0),
    grossWeightKg: Number(item.grossWeightKg ?? 0), unitPrice: Number(item.unitPrice), priceSource: (item.priceSource ?? 'MANUAL') as PriceSource,
    listPrice: item.listPrice === undefined || item.listPrice === null ? null : Number(item.listPrice),
    hint: data.editing ? '' : '复制自旧报价', image: item.image, textEdited: true,
  })));

  /** 币种、调价或客户变化时，重新带出非手动单价。 */
  const resuggest = (current: Line[], opts: { currency: string; adjustPct: number; lastQuotes: Map<string, LastQuotedPrice>; fromCurrency?: string }) =>
    current.map(line => {
      const variant = line.variantId ? catalogById.get(line.variantId) : undefined;
      if (opts.fromCurrency && opts.fromCurrency !== opts.currency) {
        if (variant) {
          const s = suggestFor(variant, opts);
          return { ...line, unitPrice: s.price, priceSource: s.source, listPrice: s.listPrice, hint: s.hint };
        }
        const converted = line.unitPrice === null ? null : convert(line.unitPrice, opts.fromCurrency, opts.currency, data.fx);
        return { ...line, unitPrice: converted, priceSource: 'MANUAL' as const, hint: converted === null ? '缺少汇率，请重新填写单价' : '已按汇率换算' };
      }
      if (!variant || line.priceSource === 'MANUAL') return line;
      const s = suggestFor(variant, opts);
      return { ...line, unitPrice: s.price, priceSource: s.source, listPrice: s.listPrice, hint: s.hint };
    });

  // ── 客户 ──
  async function chooseCustomer(next: QuoteCustomer | null) {
    setCustomer(next);
    setBuyer(buyerFrom(next));
    if (!next) { setHistory([]); return; }
    if (!destination || destination === customer?.country) setDestination(next.country);
    let nextCurrency = currency;
    if (!lines.length && (QUOTE_CURRENCIES as readonly string[]).includes(next.currency)) {
      nextCurrency = next.currency;
      changeCurrency(next.currency);
    }
    try {
      const rows = await api<PriceHistoryRow[]>(`quotes/price-history?customerId=${encodeURIComponent(next.id)}${data.editing ? `&excludeQuoteId=${data.editing.id}` : ''}`);
      setHistory(rows);
      const map = lastQuoteMap(rows);
      setLines(current => resuggest(current, { currency: nextCurrency, adjustPct, lastQuotes: map }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ── 币种 / 语言 ──
  function applyLanguage(next: QuoteLanguage) {
    setLanguage(next);
    if (!termsTouched) setTerms(templateTerms(next));
    if (!validTouched) setValidUntil(addDays(quoteDate, template(next).validDays));
    setLines(current => current.map(line => {
      const variant = line.variantId ? catalogById.get(line.variantId) : undefined;
      const unit = line.unit === template(language).unitLabel ? template(next).unitLabel : line.unit;
      if (!variant || line.textEdited) return { ...line, unit };
      return { ...line, unit, name: variant.names[next], dimensions: variant.dims[next], material: variant.material[next] };
    }));
  }

  function changeCurrency(next: string) {
    if (next === currency) return;
    const from = currency;
    setCurrency(next);
    setLines(current => resuggest(current, { currency: next, adjustPct, lastQuotes, fromCurrency: from }));
    // 手填的运费与其他费用按汇率换算；选了运价的运费回到自动计算（按新币种重算）
    if (freightChoice.kind === 'rate') setFreightOverride(null);
    else if (freightOverride !== null) setFreightOverride(convert(freightOverride, from, next, data.fx) ?? 0);
    if (otherAmount) setOtherAmount(convert(otherAmount, from, next, data.fx) ?? 0);
    if (lines.length || otherAmount || freightOverride) setNotice(`已切换为${CURRENCY_NAMES[next]}，单价与费用已按新币种重新带出，请核对`);
    if (!languageTouched) applyLanguage(languageForCurrency(next));
  }

  function changeAdjust(next: number) {
    setAdjustPct(next);
    setLines(current => resuggest(current, { currency, adjustPct: next, lastQuotes }));
  }

  // ── 产品行 ──
  function addVariant(variant: CatalogVariant) {
    setLines(current => {
      const existing = current.find(line => line.variantId === variant.variantId);
      if (existing) return current.map(line => (line === existing ? { ...line, quantity: line.quantity + 1 } : line));
      return [...current, lineFromVariant(variant, language)];
    });
    setNotice('');
  }

  function addCustom() {
    const key = nextKey();
    setLines(current => [...current, {
      key, variantId: null, name: '', dimensions: '', material: '', packing: '', unit: template(language).unitLabel, note: '', quantity: 1,
      cbm: 0, grossWeightKg: 0, unitPrice: null, priceSource: 'MANUAL', listPrice: null, hint: '自定义行：请填写名称与单价', image: null, textEdited: true,
    }]);
    setExpanded(key);
  }

  const updateLine = (key: string, patch: Partial<Line>) => setLines(current => current.map(line => (line.key === key ? { ...line, ...patch } : line)));

  function resetPrice(line: Line) {
    const variant = line.variantId ? catalogById.get(line.variantId) : undefined;
    if (!variant) return;
    const s = suggestFor(variant, { currency, adjustPct, lastQuotes });
    updateLine(line.key, { unitPrice: s.price, priceSource: s.source, listPrice: s.listPrice, hint: s.hint });
  }

  // ── 合计与运费 ──
  const totalsBase = computeTotals(lines.map(line => ({ quantity: line.quantity, unitPrice: line.unitPrice ?? 0, cbm: line.cbm, grossWeightKg: line.grossWeightKg })), 0, 0);
  const rates = data.freightRates;
  const destinationKey = destination.trim().toLowerCase();
  const matchingRates = destinationKey
    ? rates.filter(rate => rate.country.toLowerCase().includes(destinationKey) || destinationKey.includes(rate.country.toLowerCase()) || (rate.port && rate.port.toLowerCase().includes(destinationKey)))
    : [];
  const visibleRates = showAllRates || !matchingRates.length ? rates : matchingRates;
  const freightFor = (rate: FreightRateView) => computeFreight(
    { basis: rate.basis as FreightBasis, rate: rate.rate, currency: rate.currency, volumetricKgPerCbm: rate.volumetricKgPerCbm, minChargeQty: rate.minChargeQty },
    { cbm: totalsBase.totalCbm, grossWeightKg: totalsBase.totalGrossWeightKg },
    currency,
    data.fx,
  );
  const selectedRate = freightChoice.kind === 'rate' ? rates.find(rate => rate.id === freightChoice.rateId) ?? null : null;
  const computedFreight = selectedRate ? freightFor(selectedRate) : null;
  const freightAmount = freightChoice.kind === 'none' ? 0 : freightOverride ?? computedFreight?.amount ?? 0;
  const freightMissingFx = freightChoice.kind === 'rate' && freightOverride === null && computedFreight?.amount === null;
  const totals = computeTotals(lines.map(line => ({ quantity: line.quantity, unitPrice: line.unitPrice ?? 0, cbm: line.cbm, grossWeightKg: line.grossWeightKg })), freightAmount, otherAmount);

  function chooseRate(rate: FreightRateView) {
    setFreightChoice({ kind: 'rate', rateId: rate.id });
    setFreightOverride(null);
    setIncoterm(rate.incoterm);
    setIncotermPlace([rate.port, destination || rate.country].filter(Boolean).join(', '));
  }

  function changeIncoterm(next: string) {
    setIncoterm(next);
    const remembered = readStored(PLACE_KEY + next);
    if (remembered && freightChoice.kind === 'none') setIncotermPlace(remembered);
  }

  // ── 毛利（仅管理员，成本不进入单据） ──
  const rateCny = cnyPer(currency, data.fx);
  const marginOf = (line: Line) => {
    if (!data.isAdmin || !line.variantId || line.unitPrice === null || rateCny === null) return null;
    const cost = catalogById.get(line.variantId)?.costCny ?? null;
    return marginPct(line.unitPrice * rateCny, cost);
  };
  const marginTotals = data.isAdmin && rateCny !== null
    ? lines.reduce((acc, line) => {
        const cost = line.variantId ? catalogById.get(line.variantId)?.costCny ?? null : null;
        if (cost === null || line.unitPrice === null) return acc;
        return { revenue: acc.revenue + line.unitPrice * rateCny * line.quantity, cost: acc.cost + cost * line.quantity, covered: acc.covered + 1 };
      }, { revenue: 0, cost: 0, covered: 0 })
    : null;

  // ── 预览 ──
  const header = template(language);
  const preview: QuoteDocumentData = {
    quoteNumber: data.editing?.quoteNumber ?? PLACEHOLDER_NUMBER[language],
    language,
    currency,
    incoterm,
    incotermPlace,
    quoteDate,
    validUntil,
    destination,
    header: { title: header.title, companyLine: header.companyLine, contactLine: header.contactLine, footer: header.footer, preparedByRole: header.preparedByRole },
    preparedBy: data.preparedBy,
    buyer,
    terms,
    items: lines.map((line, index) => ({
      name: line.name || '—', dimensions: line.dimensions, material: line.material, packing: line.packing, unit: line.unit, note: line.note,
      quantity: line.quantity, cbm: line.cbm, grossWeightKg: line.grossWeightKg, unitPrice: line.unitPrice ?? 0, amount: totals.lines[index], image: line.image,
    })),
    totals: {
      totalQuantity: totals.totalQuantity, totalCbm: totals.totalCbm, totalGrossWeightKg: totals.totalGrossWeightKg,
      subtotal: totals.subtotal, freight: totals.freight, other: totals.other, total: totals.total,
    },
    freight: freightChoice.kind === 'none' ? null : { mode: selectedRate?.mode ?? '', incoterm },
  };

  // ── 保存 ──
  const missingPrice = lines.filter(line => line.unitPrice === null || Number.isNaN(line.unitPrice));
  const blockers = [
    !customer && '请选择客户',
    !lines.length && '请至少添加一个产品',
    missingPrice.length > 0 && `${missingPrice.length} 行还没有单价`,
    lines.some(line => !line.name.trim()) && '有产品行没有填写型号 / 规格',
    freightMissingFx && '运费缺少汇率，请手动填写运费',
  ].filter(Boolean) as string[];

  async function save() {
    if (blockers.length || !customer) { setError(blockers.join('；')); return; }
    setSaving(true);
    setError('');
    const payload = {
      customerId: customer.id,
      currency,
      language,
      incoterm,
      incotermPlace,
      quoteDate,
      validUntil,
      destination,
      buyer,
      terms,
      freight: freightChoice.kind === 'none'
        ? null
        : { rateId: freightChoice.kind === 'rate' ? freightChoice.rateId : null, amount: freightAmount, manual: freightChoice.kind === 'manual' || freightOverride !== null },
      otherAmount,
      remark,
      items: lines.map(line => ({
        variantId: line.variantId, name: line.name, dimensions: line.dimensions, material: line.material, packing: line.packing, unit: line.unit, note: line.note,
        quantity: line.quantity, cbm: line.cbm, grossWeightKg: line.grossWeightKg, unitPrice: line.unitPrice, priceSource: line.priceSource, listPrice: line.listPrice,
      })),
    };
    if (incotermPlace) writeStored(PLACE_KEY + incoterm, incotermPlace);
    try {
      const saved = data.editing
        ? await api<{ id: string }>(`quotes/${data.editing.id}`, 'PUT', { ...payload, expectedUpdatedAt: data.editing.updatedAt })
        : await api<{ id: string }>('quotes', 'POST', payload);
      router.push(`/products/quotes/${saved.id}?saved=1`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const priceText = (value: number) => `${currency} ${formatAmount(value, 'zh')}`;

  return (
    <>
      <Header
        eyebrow="产品库 · 报价单"
        title={data.editing ? `修改报价 ${data.editing.quoteNumber}` : '新建报价'}
        description="选客户 → 加产品 → 选运费，单价自动带出、可逐行修改；保存后生成图片和 PDF。"
        actions={<Link href="/products/quotes" className="bos-button">返回报价单</Link>}
      />

      {!!data.demand.length && customer?.id === data.customer?.id && <p className="quote-demand"><b>客户确认过的需求</b>{data.demand.map(d => <span key={d.label}>{d.label}：{d.value}</span>)}<small>来自聊天里的需求画像；价格、起订量、交期以产品库为准</small></p>}

      <div className="bos-quote-mobile-switch bos-tabs" role="tablist" aria-label="编辑或预览">
        <button type="button" role="tab" aria-selected={mobileView === 'edit'} onClick={() => setMobileView('edit')}><PencilLine size={15} /> 编辑</button>
        <button type="button" role="tab" aria-selected={mobileView === 'preview'} onClick={() => setMobileView('preview')}><Eye size={15} /> 预览</button>
      </div>

      <div className={`bos-quote-builder is-${mobileView}`}>
        <div className="bos-quote-form">
          <Card>
            <div className="bos-section-title">
              <div><Typography as="h2" variant="heading">1 · 客户与币种</Typography><p>报价单会保存在客户档案里，以后可以随时查到给他报过的价格</p></div>
            </div>
            <CustomerPicker value={customer} onChange={next => void chooseCustomer(next)} locked={Boolean(data.editing)} />
            <div className="bos-quote-row">
              <div className="bos-quote-field">
                <span>币种</span>
                <div className="bos-quote-segment" role="radiogroup" aria-label="币种">
                  {QUOTE_CURRENCIES.map(code => (
                    <button key={code} type="button" role="radio" aria-checked={currency === code} onClick={() => changeCurrency(code)}>
                      {code}<small>{CURRENCY_NAMES[code]}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="bos-quote-field">
                <span>单据语言 {!languageTouched && <em>· 人民币自动中文，外币自动英文</em>}</span>
                <div className="bos-quote-segment" role="radiogroup" aria-label="单据语言">
                  {QUOTE_LANGUAGES.map(code => (
                    <button key={code} type="button" role="radio" aria-checked={language === code} onClick={() => { setLanguageTouched(true); applyLanguage(code); }}>
                      {LANGUAGE_NAMES[code]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="bos-quote-field">
              <span>按价格表调价 <em>· 只影响从价格表带出的单价；上次报价与手动改过的不动</em></span>
              <div className="bos-quote-adjust">
                {ADJUST_PRESETS.map(value => (
                  <button key={value} type="button" className={adjustPct === value ? 'is-active' : ''} aria-pressed={adjustPct === value} onClick={() => changeAdjust(value)}>
                    {value > 0 ? `+${value}` : value}%
                  </button>
                ))}
                <label>
                  <NumberField value={adjustPct} aria-label="自定义调价百分比" onValue={v => changeAdjust(Math.max(-90, Math.min(500, Math.round(v ?? 0))))} />%
                </label>
              </div>
            </div>
          </Card>

          <Card>
            <div className="bos-section-title">
              <div><Typography as="h2" variant="heading">2 · 产品</Typography><p>点一下加入，单价按「上次报价 → 价格表 → 汇率折算」自动带出</p></div>
            </div>
            <ProductPicker
              catalog={data.catalog}
              currency={currency}
              language={language}
              fx={data.fx}
              adjustPct={adjustPct}
              lastQuotes={lastQuotes}
              initialQuery={data.initialProduct}
              onAdd={addVariant}
              onAddCustom={addCustom}
            />
            {notice && <p className="bos-quote-notice" role="status">{notice}</p>}
            <ol className="bos-quote-lines" aria-label="报价产品">
              {lines.map((line, index) => {
                const margin = marginOf(line);
                const open = expanded === line.key;
                return (
                  <li key={line.key} className={line.unitPrice === null ? 'is-missing' : ''}>
                    <div className="bos-quote-line">
                      <span className="bos-quote-line-no">{index + 1}</span>
                      {line.image
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`/${line.image}`} alt="" width={56} height={42} />
                        : <span className="bos-quote-thumb-missing" aria-hidden>—</span>}
                      <div className="bos-quote-line-name">
                        <input className="bos-input" value={line.name} aria-label={`第 ${index + 1} 行型号 / 规格`} placeholder="型号 / 规格"
                          onChange={e => updateLine(line.key, { name: e.target.value, textEdited: true })} />
                        <small>{[line.dimensions, line.cbm ? `${line.cbm} CBM` : '', line.grossWeightKg ? `${line.grossWeightKg} kg` : ''].filter(Boolean).join(' · ') || '未填写规格'}</small>
                      </div>
                      <label className="bos-quote-line-qty">
                        <span>数量</span>
                        <NumberField value={line.quantity} inputMode="numeric" aria-label={`第 ${index + 1} 行数量`}
                          onValue={v => { if (v !== null) updateLine(line.key, { quantity: Math.max(1, Math.min(100000, Math.round(v))) }); }} />
                      </label>
                      <label className="bos-quote-line-price">
                        <span>单价 ({currency})</span>
                        <NumberField value={line.unitPrice} placeholder="填写单价" aria-label={`第 ${index + 1} 行单价`}
                          onValue={v => updateLine(line.key, { unitPrice: v === null ? null : Math.max(0, Math.round(v * 100) / 100), priceSource: 'MANUAL', hint: '手动填写' })} />
                      </label>
                      <div className="bos-quote-line-amount">
                        <strong>{priceText(totals.lines[index])}</strong>
                        <span className="bos-quote-source">
                          <Badge tone={line.priceSource === 'MANUAL' ? 'warning' : line.priceSource === 'LAST_QUOTE' ? 'green' : 'neutral'}>{SOURCE_LABEL[line.priceSource]}</Badge>
                          {line.variantId && line.priceSource === 'MANUAL' && (
                            <button type="button" className="bos-quote-icon" onClick={() => resetPrice(line)} aria-label="恢复建议单价" title="恢复建议单价"><RotateCcw size={13} /></button>
                          )}
                        </span>
                        {margin !== null && (
                          <small className={margin < 0 ? 'bos-sales-error' : margin < LOW_MARGIN ? 'bos-quote-warn' : 'bos-quote-ok'}>毛利 {margin}%</small>
                        )}
                      </div>
                      <div className="bos-quote-line-tools">
                        <button type="button" className="bos-quote-icon" aria-expanded={open} aria-label={open ? '收起规格' : '编辑规格'} onClick={() => setExpanded(open ? null : line.key)}>
                          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                        <button type="button" className="bos-quote-icon" aria-label={`删除第 ${index + 1} 行`} onClick={() => setLines(current => current.filter(item => item.key !== line.key))}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    {line.hint && <p className="bos-quote-hint">{line.hint}{line.listPrice !== null && line.priceSource !== 'LIST' ? ` · 价格表 ${priceText(line.listPrice)}` : ''}</p>}
                    {open && (
                      <div className="bos-quote-line-detail">
                        {([
                          ['dimensions', '产品尺寸 (cm)'], ['material', '材质 / 面料'], ['packing', '包装尺寸 (cm)'], ['unit', '单位'], ['note', '备注（显示在型号下方，如颜色）'],
                        ] as const).map(([field, label]) => (
                          <label key={field} className="bos-quote-field">
                            <span>{label}</span>
                            <input className="bos-input" value={line[field]} onChange={e => updateLine(line.key, { [field]: e.target.value, textEdited: true } as Partial<Line>)} />
                          </label>
                        ))}
                        <label className="bos-quote-field">
                          <span>单件 CBM</span>
                          <NumberField value={line.cbm} onValue={v => updateLine(line.key, { cbm: Math.max(0, v ?? 0) })} />
                        </label>
                        <label className="bos-quote-field">
                          <span>单件毛重 (kg)</span>
                          <NumberField value={line.grossWeightKg} onValue={v => updateLine(line.key, { grossWeightKg: Math.max(0, v ?? 0) })} />
                        </label>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {!lines.length && <p className="bos-quote-empty">还没有产品。在上面搜索型号，点一下就加入报价。</p>}
            {lines.length > 0 && (
              <dl className="bos-quote-subtotals">
                <div><dt>总数量</dt><dd>{totals.totalQuantity}</dd></div>
                <div><dt>总体积</dt><dd>{totals.totalCbm} CBM</dd></div>
                <div><dt>总毛重</dt><dd>{totals.totalGrossWeightKg} kg</dd></div>
                <div><dt>产品小计</dt><dd>{priceText(totals.subtotal)}</dd></div>
                {marginTotals && marginTotals.covered > 0 && (
                  <div className="bos-quote-internal"><dt>产品毛利（仅管理员可见）</dt><dd>{marginPct(marginTotals.revenue, marginTotals.cost)}%<small>{marginTotals.covered}/{lines.length} 行有成本</small></dd></div>
                )}
              </dl>
            )}
          </Card>

          <Card>
            <div className="bos-section-title">
              <div><Typography as="h2" variant="heading">3 · 运费与贸易条款</Typography><p>按总毛重 / 总体积自动算运费，数字可以手动改</p></div>
              <Link href="/products/freight" className="bos-text-link"><Truck size={14} /> 运费库</Link>
            </div>
            <div className="bos-quote-row">
              <label className="bos-quote-field">
                <span>目的国 / 地区</span>
                <input className="bos-input" value={destination} placeholder="例如 France、India" onChange={e => setDestination(e.target.value)} />
              </label>
              <label className="bos-quote-field">
                <span>其他费用（税费、验货等）</span>
                <NumberField value={otherAmount || null} placeholder="0" onValue={v => setOtherAmount(Math.max(0, Math.round((v ?? 0) * 100) / 100))} />
              </label>
            </div>
            <div className="bos-quote-freight" role="radiogroup" aria-label="运费">
              <button type="button" role="radio" aria-checked={freightChoice.kind === 'none'} onClick={() => { setFreightChoice({ kind: 'none' }); setFreightOverride(null); }}>
                <strong>不含运费</strong><small>EXW / FOB 等，客户自己安排</small>
              </button>
              {visibleRates.map(rate => {
                const result = freightFor(rate);
                const basis = FREIGHT_BASIS_LABELS[rate.basis];
                return (
                  <button key={rate.id} type="button" role="radio" aria-checked={freightChoice.kind === 'rate' && freightChoice.rateId === rate.id} onClick={() => chooseRate(rate)}>
                    <strong>{rate.country}{rate.port ? ` · ${rate.port}` : ''} · {FREIGHT_MODE_LABELS[rate.mode]?.zh ?? rate.mode} {rate.incoterm}</strong>
                    <small>
                      {rate.currency} {formatAmount(rate.rate, 'zh')} / {basis?.unit ?? rate.basis}
                      {rate.volumetricKgPerCbm ? ` · 计泡 1:${rate.volumetricKgPerCbm}` : ''}
                      {rate.minChargeQty ? ` · 最低 ${rate.minChargeQty} ${basis?.unit ?? ''}` : ''}
                      {rate.transitDays ? ` · ${rate.transitDays}` : ''}
                    </small>
                    <em>{lines.length ? (result.amount === null ? `${rate.currency} ${formatAmount(result.amountInRateCurrency, 'zh')}（缺汇率）` : `≈ ${priceText(result.amount)}`) : '加入产品后计算'}{lines.length ? ` · 计费 ${result.chargeableQty} ${basis?.unit ?? ''}` : ''}</em>
                  </button>
                );
              })}
              <button type="button" role="radio" aria-checked={freightChoice.kind === 'manual'} onClick={() => { setFreightChoice({ kind: 'manual' }); setFreightOverride(freightOverride ?? freightAmount); }}>
                <strong>手动填写运费</strong><small>货代单独报的价格</small>
              </button>
            </div>
            {!rates.length && <p className="bos-quote-hint">运费库还没有运价。<Link href="/products/freight">去添加</Link>，例如 法国 22 元/kg、印度 550 美金/立方。</p>}
            {rates.length > 0 && destinationKey && !matchingRates.length && <p className="bos-quote-hint">运费库没有「{destination}」的运价，下面列出全部运价。</p>}
            {matchingRates.length > 0 && matchingRates.length < rates.length && (
              <button type="button" className="bos-text-link bos-quote-link-button" onClick={() => setShowAllRates(!showAllRates)}>{showAllRates ? `只看 ${destination} 的运价` : '显示全部运价'}</button>
            )}
            {freightChoice.kind !== 'none' && (
              <div className="bos-quote-row">
                <label className="bos-quote-field">
                  <span>运费金额 ({currency}) {freightOverride !== null && freightChoice.kind === 'rate' && <em>· 已手动修改</em>}</span>
                  <NumberField value={freightChoice.kind === 'rate' && freightOverride === null ? (computedFreight?.amount ?? null) : freightOverride}
                    placeholder={freightMissingFx ? '缺少汇率，请手动填写' : '0'} aria-label="运费金额"
                    onValue={v => setFreightOverride(v === null ? (freightChoice.kind === 'manual' ? 0 : null) : Math.max(0, Math.round(v * 100) / 100))} />
                </label>
                {freightChoice.kind === 'rate' && freightOverride !== null && (
                  <Button onClick={() => setFreightOverride(null)}><RotateCcw size={14} /> 恢复自动计算</Button>
                )}
              </div>
            )}
            {freightMissingFx && <p className="bos-quote-hint bos-sales-error" role="alert">运价币种与报价币种之间缺少汇率。请在<Link href="/products/quotes/settings">报价设置</Link>填写汇率，或直接手动填写运费。</p>}
            <div className="bos-quote-row">
              <label className="bos-quote-field">
                <span>贸易条款</span>
                <select className="bos-input" value={incoterm} onChange={e => changeIncoterm(e.target.value)}>
                  {QUOTE_INCOTERMS.map(code => <option key={code}>{code}</option>)}
                </select>
              </label>
              <label className="bos-quote-field bos-quote-grow">
                <span>指定地点</span>
                <input className="bos-input" value={incotermPlace} placeholder="例如 Foshan, Guangdong, China 或 Mumbai, India" onChange={e => setIncotermPlace(e.target.value)} />
              </label>
            </div>
            <div className="bos-quote-row">
              <label className="bos-quote-field">
                <span>报价日期</span>
                <input className="bos-input" type="date" value={quoteDate} onChange={e => {
                  setQuoteDate(e.target.value);
                  if (!validTouched) setValidUntil(addDays(e.target.value, template(language).validDays));
                }} />
              </label>
              <label className="bos-quote-field">
                <span>有效期至</span>
                <input className="bos-input" type="date" value={validUntil} min={quoteDate} onChange={e => { setValidUntil(e.target.value); setValidTouched(true); }} />
              </label>
            </div>
          </Card>

          <Card>
            <button type="button" className="bos-quote-collapse" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>
              <span><Typography as="h2" variant="heading">4 · 买方信息与交易条款</Typography><small>已按客户资料和{LANGUAGE_NAMES[language]}模板填好，需要时再改</small></span>
              {showDetails ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {showDetails && (
              <div className="bos-quote-details">
                <div className="bos-quote-grid">
                  {([['company', '客户公司'], ['attn', '联系人'], ['email', '邮箱'], ['phone', '电话 / WhatsApp'], ['address', '收货地址']] as const).map(([field, label]) => (
                    <label key={field} className="bos-quote-field">
                      <span>{label}</span>
                      <input className="bos-input" value={buyer[field]} onChange={e => setBuyer({ ...buyer, [field]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <div className="bos-quote-grid">
                  {([['paymentTerms', '付款方式'], ['leadTime', '生产周期'], ['moq', '起订量'], ['packing', '包装方式'], ['warranty', '质保'], ['priceBasis', '价格说明']] as const).map(([field, label]) => (
                    <label key={field} className="bos-quote-field">
                      <span>{label}</span>
                      <input className="bos-input" value={terms[field]} onChange={e => { setTerms({ ...terms, [field]: e.target.value }); setTermsTouched(true); }} />
                    </label>
                  ))}
                </div>
                <label className="bos-quote-field">
                  <span>报价说明</span>
                  <textarea className="bos-input" rows={5} value={terms.notes} onChange={e => { setTerms({ ...terms, notes: e.target.value }); setTermsTouched(true); }} />
                </label>
                {termsTouched && <Button variant="ghost" onClick={() => { setTerms(templateTerms(language)); setTermsTouched(false); }}><RotateCcw size={14} /> 恢复{LANGUAGE_NAMES[language]}模板条款</Button>}
              </div>
            )}
            <label className="bos-quote-field">
              <span>内部备注 <em>· 不显示在报价单上</em></span>
              <textarea className="bos-input" rows={2} value={remark} placeholder="例如：零售客户，价格上浮 15%" onChange={e => setRemark(e.target.value)} />
            </label>
          </Card>
        </div>

        <aside className="bos-quote-preview-pane" aria-label="报价单预览">
          <div className="bos-quote-savebar">
            <div>
              <span>报价总额</span>
              <strong>{priceText(totals.total)}</strong>
              {blockers.length > 0 && <small>{blockers[0]}</small>}
            </div>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              <Save size={15} /> {saving ? '保存中…' : data.editing ? '保存修改' : '保存并生成报价单'}
            </Button>
          </div>
          {error && <p className="bos-sales-error bos-quote-error" role="alert">{error}</p>}
          <ScaledPreview label="报价单预览">
            <QuoteDocument data={preview} placeholder="添加产品后在这里预览" />
          </ScaledPreview>
        </aside>
      </div>
    </>
  );
}
