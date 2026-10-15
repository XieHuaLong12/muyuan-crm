import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import {
  computeFreight, computeTotals, convert, languageForCurrency, marginPct, quoteNumberFor, suggestUnitPrice,
} from '../lib/quote-math';
import { jpegPagesToPdf, paginate } from '../lib/quote-pdf';
import { quotationAmount } from '../lib/quotation-amount';
import { createFreightRate, listFreightRates, updateFreightRate } from '../services/freight-service';
import {
  createItemizedQuote, customerPriceHistory, quoteBuilderData, quoteDetail, quoteList, searchQuoteCustomers, updateItemizedQuote,
} from '../services/itemized-quote-service';
import { saveQuoteRates, saveQuoteTemplate, quoteSettings } from '../services/quote-template-service';
import { createQuotation, markQuoteSent } from '../services/quotation-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const fx = { usdCny: 6.7, eurCny: 7.8 };

test('报价计算：行金额按分计算，合计含运费与其他费用', () => {
  const totals = computeTotals(
    [
      { quantity: 3, unitPrice: 246.27, cbm: 0.32, grossWeightKg: 72 },
      { quantity: 10, unitPrice: 0.1, cbm: 0.1, grossWeightKg: 1.15 },
    ],
    100.555,
    20,
  );
  assert.deepEqual(totals.lines, [738.81, 1]);
  assert.equal(totals.subtotal, 739.81);
  assert.equal(totals.totalQuantity, 13);
  assert.equal(totals.totalCbm, 1.96);
  assert.equal(totals.totalGrossWeightKg, 227.5);
  assert.equal(totals.freight, 100.56);
  assert.equal(totals.total, 860.37);
});

test('运费：按公斤取实重与体积重较大值，按立方 / 整柜 / 最低计费量', () => {
  // 法国 22 元/kg，计泡 1:200：2 CBM / 300 kg → 计费 400 kg
  const france = computeFreight({ basis: 'KG', rate: 22, currency: 'CNY', volumetricKgPerCbm: 200, minChargeQty: 21 }, { cbm: 2, grossWeightKg: 300 }, 'USD', fx);
  assert.equal(france.chargeableQty, 400);
  assert.equal(france.volumetricKg, 400);
  assert.equal(france.amountInRateCurrency, 8800);
  assert.equal(france.amount, 1313.43, '8800 CNY ÷ 6.7');
  // 实重更大时按实重；低于最低计费量按最低计费量
  assert.equal(computeFreight({ basis: 'KG', rate: 22, currency: 'CNY', volumetricKgPerCbm: 200, minChargeQty: null }, { cbm: 1, grossWeightKg: 260 }, 'CNY', fx).chargeableQty, 260);
  assert.equal(computeFreight({ basis: 'KG', rate: 22, currency: 'CNY', volumetricKgPerCbm: null, minChargeQty: 21 }, { cbm: 0.1, grossWeightKg: 15 }, 'CNY', fx).amount, 462);
  // 印度 550 美元/立方，最低 1 方
  const india = computeFreight({ basis: 'CBM', rate: 550, currency: 'USD', volumetricKgPerCbm: null, minChargeQty: 1 }, { cbm: 0.56, grossWeightKg: 120 }, 'USD', fx);
  assert.equal(india.chargeableQty, 1);
  assert.equal(india.amount, 550);
  assert.equal(computeFreight({ basis: 'CBM', rate: 550, currency: 'USD', volumetricKgPerCbm: null, minChargeQty: 1 }, { cbm: 3.25, grossWeightKg: 500 }, 'CNY', fx).amount, 11976.25);
  // 整柜向上取整：69 方需要 2 个 40HQ
  assert.equal(computeFreight({ basis: 'CONTAINER_40HQ', rate: 3000, currency: 'USD', volumetricKgPerCbm: null, minChargeQty: null }, { cbm: 69, grossWeightKg: 9000 }, 'USD', fx).chargeableQty, 2);
  assert.equal(computeFreight({ basis: 'SHIPMENT', rate: 80, currency: 'EUR', volumetricKgPerCbm: null, minChargeQty: null }, { cbm: 1, grossWeightKg: 1 }, 'EUR', fx).amount, 80);
  // 缺欧元汇率：不折算，交给人工
  assert.equal(computeFreight({ basis: 'CBM', rate: 550, currency: 'USD', volumetricKgPerCbm: null, minChargeQty: null }, { cbm: 1, grossWeightKg: 1 }, 'EUR', { usdCny: 6.7, eurCny: null }).amount, null);
});

test('智能单价：上次报价优先，其次价格表（含调价），再次按汇率折算，否则留空', () => {
  const prices = { USD: 246.27, CNY: 1650 };
  assert.equal(languageForCurrency('CNY'), 'zh');
  assert.equal(languageForCurrency('USD'), 'en');
  assert.equal(languageForCurrency('EUR'), 'en');
  const last = suggestUnitPrice({ prices, currency: 'USD', fx, adjustPct: 15, lastQuote: { unitPrice: 239, currency: 'USD', quoteNumber: 'LVJ-202610-001', date: '2026-10-01' } });
  assert.equal(last.price, 239);
  assert.equal(last.source, 'LAST_QUOTE');
  assert.equal(last.listPrice, 246.27);
  // 上次报价是其他币种时不沿用
  assert.equal(suggestUnitPrice({ prices, currency: 'CNY', fx, adjustPct: 0, lastQuote: { unitPrice: 239, currency: 'USD', quoteNumber: 'x', date: 'y' } }).price, 1650);
  const retail = suggestUnitPrice({ prices, currency: 'USD', fx, adjustPct: 15 });
  assert.equal(retail.price, 283.21);
  assert.equal(retail.source, 'LIST');
  const euro = suggestUnitPrice({ prices, currency: 'EUR', fx, adjustPct: 0 });
  assert.equal(euro.price, convert(246.27, 'USD', 'EUR', fx));
  assert.match(euro.hint, /按汇率折算/);
  const none = suggestUnitPrice({ prices: {}, currency: 'USD', fx, adjustPct: 0 });
  assert.equal(none.price, null);
  assert.equal(none.source, 'MANUAL');
  assert.equal(quoteNumberFor('LVJ', '202610', 7), 'LVJ-202610-007');
  assert.equal(marginPct(100, 60), 40);
  assert.equal(marginPct(0, 60), null);
});

test('PDF：分页落在内容块边缘，生成的文件结构完整', () => {
  assert.deepEqual(paginate(2500, [100, 400, 980, 1200, 1900, 2400], 1000), [[0, 980], [980, 1900], [1900, 2500]]);
  assert.deepEqual(paginate(500, [100], 1000), [[0, 500]]);
  // 没有可断开的位置时按页高硬切
  assert.deepEqual(paginate(2100, [], 1000), [[0, 1000], [1000, 2000], [2000, 2100]]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = jpegPagesToPdf([{ jpeg, width: 10, height: 20 }, { jpeg, width: 10, height: 5 }], { title: 'LVJ-202610-001 (A)' });
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/Title \(LVJ-202610-001 \\\(A\\\)\)/);
  // xref 中每个偏移都指向对应对象的开头
  const xref = text.slice(text.lastIndexOf('\nxref\n'));
  const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  assert.equal(offsets.length, 9);
  offsets.forEach((offset, index) => assert.ok(text.startsWith(`${index + 1} 0 obj`, offset), `object ${index + 1}`));
  const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  assert.ok(text.startsWith('xref', startxref));
});

test('报价单：服务端重算、按月编号、运费自动计算、权限隔离、价格记录与发送后锁定', async () => {
  const tag = randomUUID().slice(0, 8);
  const adminRow = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const admin = { id: adminRow.id, name: adminRow.name, email: adminRow.email, role: 'ADMIN' };
  const salesRow = await db.user.create({ data: { name: `Quote sales ${tag}`, email: `quote-sales-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const otherRow = await db.user.create({ data: { name: `Quote other ${tag}`, email: `quote-other-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const sales = { id: salesRow.id, name: salesRow.name, email: salesRow.email, role: 'SALES' };
  const other = { id: otherRow.id, name: otherRow.name, email: otherRow.email, role: 'SALES' };
  const customer = await db.customer.create({ data: { name: `Ameer ${tag}`, companyName: `Nivas Home ${tag}`, country: 'India', email: `ameer-${tag}@example.test`, whatsapp: '+911234567890', currency: 'USD', ownerId: sales.id } });
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const rateIds: string[] = [];
  const catalogVariants = await db.productVariant.findMany({
    where: { deletedAt: null, status: 'ACTIVE', prices: { some: { currency: 'USD', status: 'ACTIVE' } }, product: { deletedAt: null, status: 'ACTIVE' } },
    include: { prices: { where: { currency: 'USD', status: 'ACTIVE' } }, product: true },
    take: 2,
    orderBy: { sku: 'asc' },
  });
  assert.equal(catalogVariants.length, 2, '需要先运行 pnpm db:seed:products');
  const [v1, v2] = catalogVariants;
  const line = (variant: typeof v1, quantity: number, unitPrice: number) => ({
    variantId: variant.id, name: `${variant.product.model} | test`, dimensions: '1×1×1', material: 'Foam', packing: '1×1×1', unit: 'Set',
    quantity, cbm: Number(variant.cbm), grossWeightKg: Number(variant.grossWeightKg), unitPrice, priceSource: 'LIST', listPrice: Number(variant.prices[0].unitPrice),
  });
  const base = {
    customerId: customer.id, currency: 'USD', incoterm: 'DDP', incotermPlace: 'Mumbai, India', quoteDate: '2026-10-11', validUntil: '2026-10-26', destination: 'India',
    buyer: { company: customer.companyName, attn: customer.name, email: customer.email, phone: customer.whatsapp, address: 'Mumbai, India' },
    terms: { paymentTerms: 'T/T 30/70', leadTime: '15 days', moq: '10 sets', packing: 'Carton', warranty: '12 months', priceBasis: 'DDP', notes: '1. Valid 15 days' },
    otherAmount: 12.5,
  };

  try {
    // ① 运费库：销售只读，管理员维护
    await assert.rejects(() => createFreightRate(sales, { country: 'India', mode: 'SEA', incoterm: 'DDP', basis: 'CBM', rate: 550, currency: 'USD' }), (e: { status?: number }) => e.status === 403);
    const india = await createFreightRate(admin, { country: `India ${tag}`, mode: 'SEA', incoterm: 'DDP', basis: 'CBM', rate: 550, currency: 'USD', minChargeQty: 1, volumetricKgPerCbm: 300 });
    rateIds.push(india.id);
    assert.equal(india.volumetricKgPerCbm, null, '计泡系数只对按公斤计费保存');
    const france = await createFreightRate(admin, { country: `France ${tag}`, mode: 'SEA', incoterm: 'DDP', basis: 'KG', rate: 22, currency: 'CNY', volumetricKgPerCbm: 200 });
    rateIds.push(france.id);
    assert.ok((await listFreightRates(sales)).some(rate => rate.id === france.id));
    await assert.rejects(() => createFreightRate(admin, { country: '', mode: 'SEA', incoterm: 'DDP', basis: 'KG', rate: 0, currency: 'CNY' }), /请填写目的国|运价必须大于 0/);
    const archived = await updateFreightRate(admin, france.id, { ...france, rate: 23, status: 'ARCHIVED', expectedUpdatedAt: france.updatedAt });
    assert.equal(archived.rate, 23);
    await assert.rejects(() => updateFreightRate(admin, france.id, { ...france, expectedUpdatedAt: france.updatedAt }), (e: { status?: number }) => e.status === 409);
    assert.ok(!(await listFreightRates(sales)).some(rate => rate.id === france.id), '归档运价不出现在默认列表');

    // ② 构建器：成本只给管理员
    const salesBuilder = await quoteBuilderData(sales, { customerId: customer.id });
    assert.equal(salesBuilder.customer?.id, customer.id);
    assert.equal(JSON.stringify(salesBuilder.catalog).includes('costCny'), false, '销售的目录里不能出现成本字段');
    assert.ok((await quoteBuilderData(admin, {})).catalog.every(v => 'costCny' in v));
    // 从聊天生成报价：目录里有的型号带入最小尺寸和数量，AI 编出来的型号只提示，不加行
    const fromChat = await quoteBuilderData(sales, { customerId: customer.id, items: `${v1.product.model.toLowerCase()}:40,NOT-A-MODEL-9:2` });
    assert.equal(fromChat.prefill.length, 1);
    assert.equal(fromChat.prefill[0].quantity, 40);
    assert.equal(fromChat.catalog.find(v => v.variantId === fromChat.prefill[0].variantId)?.model, v1.product.model);
    assert.deepEqual(fromChat.prefillMissing, ['NOT-A-MODEL-9']);
    assert.equal((await quoteBuilderData(other, { customerId: customer.id })).customer, null, '其他销售看不到这个客户');
    assert.ok((await searchQuoteCustomers(sales, { q: tag })).some(c => c.id === customer.id));
    assert.equal((await searchQuoteCustomers(other, { q: tag })).length, 0);

    // ③ 创建：服务端重算金额与运费，忽略前端传来的运费数字
    await assert.rejects(() => createItemizedQuote({ ...base, items: [line(v1, 2, 100)] }, other), (e: { status?: number }) => e.status === 404);
    await assert.rejects(() => createItemizedQuote({ ...base, items: [] }, sales), /至少添加一个产品/);
    await assert.rejects(() => createItemizedQuote({ ...base, validUntil: '2026-10-01', items: [line(v1, 1, 1)] }, sales), /有效期不能早于报价日期/);
    const first = await createItemizedQuote({ ...base, freight: { rateId: india.id, amount: 1, manual: false }, items: [line(v1, 2, 100.1), line(v2, 3, 50)] }, sales);
    assert.match(first.quoteNumber, /^LVJ-\d{6}-\d{3}$/);
    const saved = await db.quotation.findUniqueOrThrow({ where: { id: first.id }, include: { items: { orderBy: { sort: 'asc' } } } });
    const cbm = Number(v1.cbm) * 2 + Number(v2.cbm) * 3;
    const expectedFreight = Math.round(Math.max(cbm, 1) * 550 * 100) / 100;
    assert.equal(Number(saved.subtotalAmount), 350.2);
    assert.equal(Number(saved.freightAmount), expectedFreight);
    assert.equal(Number(saved.otherAmount), 12.5);
    assert.equal(Number(saved.totalAmount), Math.round((350.2 + expectedFreight + 12.5) * 100) / 100);
    assert.equal(saved.totalQuantity, 5);
    assert.equal(saved.quantity, 5);
    assert.equal(saved.language, 'en');
    assert.equal(saved.status, 'DRAFT');
    assert.equal(saved.freightRateId, india.id);
    assert.deepEqual(saved.items.map(item => Number(item.amount)), [200.2, 150]);
    assert.equal(saved.items[0].model, v1.product.model);
    assert.ok(quotationAmount(saved).equals(saved.totalAmount!), '报价金额口径取 totalAmount');

    const second = await createItemizedQuote({ ...base, currency: 'CNY', freight: { rateId: india.id, amount: 0, manual: false }, items: [line(v1, 1, 1650)] }, sales);
    assert.equal(Number(second.quoteNumber.slice(-3)), Number(first.quoteNumber.slice(-3)) + 1, '同月编号递增');
    const cny = await db.quotation.findUniqueOrThrow({ where: { id: second.id } });
    assert.equal(cny.language, 'zh', '人民币报价自动用中文');
    assert.equal(Number(cny.freightAmount), Math.round(550 * Number(setting.usdCnyRate) * 100) / 100, '美元运价按汇率折成人民币');

    // 欧元：没有欧元汇率时不能自动折算运费，手动运费可以
    await saveQuoteRates(admin, { usdCny: Number(setting.usdCnyRate), eurCny: '' });
    await assert.rejects(() => createItemizedQuote({ ...base, currency: 'EUR', freight: { rateId: india.id, amount: 0, manual: false }, items: [line(v1, 1, 200)] }, sales), /缺少 USD 与 EUR 的汇率/);
    const euro = await createItemizedQuote({ ...base, currency: 'EUR', language: 'fr', freight: { rateId: india.id, amount: 480, manual: true }, items: [line(v1, 1, 200)] }, sales);
    const euroRow = await db.quotation.findUniqueOrThrow({ where: { id: euro.id } });
    assert.equal(euroRow.language, 'fr');
    assert.equal(Number(euroRow.freightAmount), 480);

    // ④ 价格记录：最新在前，其他销售无权查看
    const history = await customerPriceHistory(sales, { customerId: customer.id });
    assert.equal(history[0].quoteNumber, euro.quoteNumber);
    assert.ok(history.some(row => row.variantId === v2.id && row.unitPrice === 50 && row.currency === 'USD'));
    await assert.rejects(() => customerPriceHistory(other, { customerId: customer.id }), (e: { status?: number }) => e.status === 404);

    // ⑤ 单据详情与列表
    const detail = await quoteDetail(sales, first.id);
    assert.equal(detail.document.items.length, 2);
    assert.equal(detail.document.totals.freight, expectedFreight);
    assert.equal(detail.document.buyer.company, customer.companyName);
    assert.equal(detail.document.header.title, (await quoteSettings(sales)).templates.en.title);
    assert.equal(detail.document.freight?.mode, 'SEA');
    await assert.rejects(() => quoteDetail(other, first.id), (e: { status?: number }) => e.status === 404);
    const list = await quoteList(sales, { customerId: customer.id });
    assert.equal(list.total, 3);
    assert.equal(list.rows.find(row => row.id === first.id)?.amount, Number(saved.totalAmount).toFixed(2));
    assert.equal((await quoteList(other, { q: tag })).total, 0);

    // ⑥ 修改草稿：版本冲突 409；发送后锁定
    const updated = await updateItemizedQuote(first.id, { ...base, expectedUpdatedAt: first.updatedAt.toISOString(), freight: null, items: [line(v1, 4, 99)] }, sales);
    const afterUpdate = await db.quotation.findUniqueOrThrow({ where: { id: first.id }, include: { items: true } });
    assert.equal(afterUpdate.items.length, 1);
    assert.equal(Number(afterUpdate.totalAmount), 396 + 12.5);
    assert.equal(afterUpdate.freightAmount, null);
    assert.equal(afterUpdate.quoteNumber, first.quoteNumber, '修改不换编号');
    await assert.rejects(() => updateItemizedQuote(first.id, { ...base, expectedUpdatedAt: first.updatedAt.toISOString(), items: [line(v1, 1, 1)] }, sales), (e: { status?: number }) => e.status === 409);
    await markQuoteSent(first.id, sales);
    const sentCustomer = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.equal(sentCustomer.stage, 'QUOTED');
    assert.equal(Number(sentCustomer.quotedAmount), 408.5, '客户报价金额取报价总额');
    await assert.rejects(() => updateItemizedQuote(first.id, { ...base, expectedUpdatedAt: updated.updatedAt.toISOString(), items: [line(v1, 1, 1)] }, sales), (e: { status?: number }) => e.status === 409);

    // ⑦ 复制旧单：沿用条款与行，日期换成今天
    const copy = await quoteBuilderData(sales, { from: first.id });
    assert.equal(copy.draft?.items.length, 1);
    assert.equal(copy.draft?.items[0].unitPrice, 99);
    assert.equal(copy.draft?.quoteDate, copy.today);
    assert.equal(copy.editing, null);
    await assert.rejects(() => quoteBuilderData(sales, { edit: first.id }), (e: { status?: number }) => e.status === 409);

    // ⑧ 旧的单行报价也能按单据查看
    const legacy = await createQuotation({ customerId: customer.id, product: 'Y-601 sofa', quantity: 3, unitPrice: 120, currency: 'USD', incoterm: 'FOB' }, sales);
    const legacyDetail = await quoteDetail(sales, legacy.id);
    assert.equal(legacyDetail.itemized, false);
    assert.equal(legacyDetail.document.totals.total, 360);
    assert.equal(legacyDetail.document.items[0].amount, 360);
  } finally {
    await deleteTestCustomers({ where: { id: customer.id } });
    await db.freightRate.deleteMany({ where: { id: { in: rateIds } } });
    await db.setting.update({ where: { id: 'system' }, data: { usdCnyRate: setting.usdCnyRate, eurCnyRate: setting.eurCnyRate } });
    await db.user.deleteMany({ where: { id: { in: [sales.id, other.id] } } });
  }
});

test('报价模板：只有管理员能改，保存后按数据库渲染', async () => {
  const adminRow = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const admin = { id: adminRow.id, name: adminRow.name, email: adminRow.email, role: 'ADMIN' };
  const sales = { ...admin, id: 'template-test-sales', role: 'SALES' };
  const before = await db.quoteTemplate.findUnique({ where: { language: 'fr' } });
  try {
    const defaults = (await quoteSettings(sales)).templates.fr;
    await assert.rejects(() => saveQuoteTemplate(sales, { ...defaults, language: 'fr' }), (e: { status?: number }) => e.status === 403);
    await assert.rejects(() => saveQuoteRates(sales, { usdCny: 7, eurCny: 8 }), (e: { status?: number }) => e.status === 403);
    await assert.rejects(() => saveQuoteTemplate(admin, { ...defaults, language: 'fr', title: '' }), /请填写单据标题/);
    const saved = await saveQuoteTemplate(admin, { ...defaults, language: 'fr', title: 'DEVIS TEST', validDays: 30 });
    assert.equal(saved.title, 'DEVIS TEST');
    assert.equal(saved.customized, true);
    assert.equal((await quoteSettings(sales)).templates.fr.validDays, 30);
  } finally {
    if (before) await db.quoteTemplate.update({ where: { language: 'fr' }, data: before });
    else await db.quoteTemplate.deleteMany({ where: { language: 'fr' } });
  }
});

test('报价金额口径：多行报价取总额，旧报价取单价×数量', () => {
  assert.equal(quotationAmount({ totalAmount: null, unitPrice: new Prisma.Decimal('12.50'), quantity: 4 }).toFixed(2), '50.00');
  assert.equal(quotationAmount({ totalAmount: new Prisma.Decimal('99.99'), unitPrice: new Prisma.Decimal('33.33'), quantity: 3 }).toFixed(2), '99.99');
});
