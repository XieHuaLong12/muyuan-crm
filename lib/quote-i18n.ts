import type { QuoteLanguage } from './quote-math';

/**
 * 报价单文案：单据标签按语言固定；抬头、条款与说明是「模板」，管理员可在报价设置里修改。
 * 默认模板逐字取自 LVANJU 报价单 Excel（中文报价单 / English Quotation / Devis Français）。
 */

export type QuoteLabels = {
  buyerInfo: string;
  quoteInfo: string;
  buyerCompany: string;
  attn: string;
  email: string;
  phone: string;
  shipTo: string;
  quoteNo: string;
  date: string;
  validUntil: string;
  currency: string;
  incoterm: string;
  commercialTerms: string;
  payment: string;
  leadTime: string;
  moq: string;
  packing: string;
  warranty: string;
  priceBasis: string;
  itemized: string;
  colNo: string;
  colImage: string;
  colModel: string;
  colSize: string;
  colMaterial: string;
  colPacking: string;
  colUnit: string;
  colQty: string;
  colCbm: string;
  colGw: string;
  colUnitPrice: string;
  colAmount: string;
  totals: string;
  totalQty: string;
  totalCbm: string;
  totalGw: string;
  subtotal: string;
  freight: string;
  other: string;
  noFreight: string;
  grandTotal: string;
  notes: string;
  preparedBy: string;
  bedSize: string;
  inner: string;
};

export const QUOTE_LABELS: Record<QuoteLanguage, QuoteLabels> = {
  zh: {
    buyerInfo: '买方信息',
    quoteInfo: '报价信息',
    buyerCompany: '客户公司',
    attn: '联系人',
    email: '邮箱',
    phone: '电话 / WhatsApp',
    shipTo: '收货地址',
    quoteNo: '报价编号',
    date: '报价日期',
    validUntil: '有效期至',
    currency: '币种',
    incoterm: '贸易条款',
    commercialTerms: '交易条款',
    payment: '付款方式',
    leadTime: '生产周期',
    moq: '起订量',
    packing: '包装方式',
    warranty: '质保',
    priceBasis: '价格说明',
    itemized: '产品报价明细',
    colNo: '序号',
    colImage: '产品图片',
    colModel: '型号 / 规格',
    colSize: '产品尺寸\n(W×D×H, cm)',
    colMaterial: '材质 / 面料',
    colPacking: '包装尺寸\n(L×W×H, cm)',
    colUnit: '单位',
    colQty: '数量',
    colCbm: '单件CBM',
    colGw: '单件毛重\n(kg)',
    colUnitPrice: '单价',
    colAmount: '金额',
    totals: '报价合计',
    totalQty: '总数量',
    totalCbm: '总体积（CBM）',
    totalGw: '总毛重（kg）',
    subtotal: '产品小计',
    freight: '运费',
    other: '税费 / 其他费用',
    noFreight: '运费 / 税费 / 其他费用',
    grandTotal: '报价总额',
    notes: '报价说明',
    preparedBy: '制单人',
    bedSize: '床',
    inner: '内空',
  },
  en: {
    buyerInfo: 'BUYER INFORMATION',
    quoteInfo: 'QUOTATION INFORMATION',
    buyerCompany: 'Buyer Company',
    attn: 'Attn.',
    email: 'Email',
    phone: 'Phone / WhatsApp',
    shipTo: 'Ship To',
    quoteNo: 'Quotation No.',
    date: 'Date',
    validUntil: 'Valid Until',
    currency: 'Currency',
    incoterm: 'Incoterm',
    commercialTerms: 'COMMERCIAL TERMS',
    payment: 'Payment Terms',
    leadTime: 'Lead Time',
    moq: 'MOQ',
    packing: 'Packing',
    warranty: 'Warranty',
    priceBasis: 'Price Basis',
    itemized: 'ITEMIZED QUOTATION',
    colNo: 'No.',
    colImage: 'Product Image',
    colModel: 'Model / Variant',
    colSize: 'Product Size\n(W×D×H, cm)',
    colMaterial: 'Material / Fabric',
    colPacking: 'Packing Size\n(L×W×H, cm)',
    colUnit: 'Unit',
    colQty: 'Qty',
    colCbm: 'CBM / Unit',
    colGw: 'G.W. / Unit\n(kg)',
    colUnitPrice: 'Unit Price',
    colAmount: 'Amount',
    totals: 'QUOTATION TOTALS',
    totalQty: 'Total Quantity',
    totalCbm: 'Total CBM',
    totalGw: 'Total G.W. (kg)',
    subtotal: 'Product Subtotal',
    freight: 'Freight',
    other: 'Taxes / Other Charges',
    noFreight: 'Freight / Taxes / Other Charges',
    grandTotal: 'Grand Total',
    notes: 'NOTES',
    preparedBy: 'Prepared by',
    bedSize: 'Bed',
    inner: 'Inner',
  },
  fr: {
    buyerInfo: 'INFORMATIONS DE L’ACHETEUR',
    quoteInfo: 'INFORMATIONS DU DEVIS',
    buyerCompany: 'Société',
    attn: 'À l’attention de',
    email: 'E-mail',
    phone: 'Téléphone / WhatsApp',
    shipTo: 'Adresse de livraison',
    quoteNo: 'N° du devis',
    date: 'Date',
    validUntil: 'Valable jusqu’au',
    currency: 'Devise',
    incoterm: 'Incoterm',
    commercialTerms: 'CONDITIONS COMMERCIALES',
    payment: 'Paiement',
    leadTime: 'Délai de production',
    moq: 'MOQ',
    packing: 'Emballage',
    warranty: 'Garantie',
    priceBasis: 'Base de prix',
    itemized: 'DÉTAIL DU DEVIS',
    colNo: 'N°',
    colImage: 'Photo du produit',
    colModel: 'Modèle / Variante',
    colSize: 'Dimensions produit\n(L×P×H, cm)',
    colMaterial: 'Matière / Tissu',
    colPacking: 'Dimensions colis\n(L×l×H, cm)',
    colUnit: 'Unité',
    colQty: 'Qté',
    colCbm: 'CBM / unité',
    colGw: 'Poids brut / unité\n(kg)',
    colUnitPrice: 'Prix unitaire',
    colAmount: 'Montant',
    totals: 'TOTAUX DU DEVIS',
    totalQty: 'Quantité totale',
    totalCbm: 'CBM total',
    totalGw: 'Poids brut total (kg)',
    subtotal: 'Sous-total produits',
    freight: 'Fret',
    other: 'Taxes / Autres frais',
    noFreight: 'Fret / Taxes / Autres frais',
    grandTotal: 'Total général',
    notes: 'REMARQUES',
    preparedBy: 'Préparé par',
    bedSize: 'Lit',
    inner: 'Intérieur',
  },
};

export const LANGUAGE_NAMES: Record<QuoteLanguage, string> = { zh: '中文', en: 'English', fr: 'Français' };

export const FREIGHT_MODE_LABELS: Record<string, Record<QuoteLanguage, string>> = {
  SEA: { zh: '海运', en: 'Sea freight', fr: 'Fret maritime' },
  AIR: { zh: '空运', en: 'Air freight', fr: 'Fret aérien' },
  EXPRESS: { zh: '快递', en: 'Express', fr: 'Express' },
  RAIL: { zh: '铁路', en: 'Rail freight', fr: 'Fret ferroviaire' },
  TRUCK: { zh: '陆运', en: 'Road freight', fr: 'Transport routier' },
};

/** 运费库界面用的计费方式说明（中文界面）。 */
export const FREIGHT_BASIS_LABELS: Record<string, { label: string; unit: string }> = {
  KG: { label: '按公斤', unit: 'kg' },
  CBM: { label: '按立方', unit: 'CBM' },
  CONTAINER_20GP: { label: '按 20GP 整柜', unit: '柜' },
  CONTAINER_40HQ: { label: '按 40HQ 整柜', unit: '柜' },
  SHIPMENT: { label: '按票（一口价）', unit: '票' },
};

export type QuoteTemplateText = {
  title: string;
  companyLine: string;
  contactLine: string;
  paymentTerms: string;
  leadTime: string;
  moq: string;
  packing: string;
  warranty: string;
  priceBasis: string;
  notes: string;
  footer: string;
  preparedByRole: string;
  unitLabel: string;
  validDays: number;
};

export const TEMPLATE_FIELDS = [
  'title', 'companyLine', 'contactLine', 'paymentTerms', 'leadTime', 'moq', 'packing', 'warranty', 'priceBasis', 'notes', 'footer', 'preparedByRole', 'unitLabel',
] as const;

export const DEFAULT_TEMPLATES: Record<QuoteLanguage, QuoteTemplateText> = {
  zh: {
    title: '家具出口报价单',
    companyLine: 'Foshan Shunde Mianxuanhui Furniture Co., Ltd.  |  品牌：LVANJU 绿安居',
    contactLine: '网站：lvanju.en.alibaba.com  |  邮箱：15815694430@163.com  |  WhatsApp：+86 15815694430  |  地址：中国广东佛山 528315',
    paymentTerms: 'T/T：30%订金，70%余款于发货前付清',
    leadTime: '收到订金并确认型号、颜色及规格后7–15天，具体视订单数量而定',
    moq: '样品单：2套；常规起订量：20套（不同型号可协商）',
    packing: '出口纸箱＋压缩包装（适用产品）',
    warranty: '自发货之日起12个月，适用于制造缺陷',
    priceBasis: '价格以本报价单所列贸易条款及指定地点为准',
    notes: [
      '1. 本报价有效期以“有效期至”所列日期为准',
      '2. 产品尺寸、包装尺寸、重量及CBM为预计值，以最终生产及装柜数据为准',
      '3. 除非另有书面说明，报价不包含目的地费用、进口关税、增值税、卸货及安装费用',
      '4. 收款账户以双方确认的形式发票（PI）为准；任何账户变更须通过电话或视频再次确认',
    ].join('\n'),
    footer: 'LVANJU 绿安居  |  Smarter Furniture, Smaller Volume',
    preparedByRole: '外贸业务',
    unitLabel: '套',
    validDays: 15,
  },
  en: {
    title: 'FURNITURE EXPORT QUOTATION',
    companyLine: 'Foshan Shunde Mianxuanhui Furniture Co., Ltd.  |  Brand: LVANJU',
    contactLine: 'Website: lvanju.en.alibaba.com  |  Email: 15815694430@163.com  |  WhatsApp: +86 15815694430  |  Address: Foshan, Guangdong, China 528315',
    paymentTerms: 'T/T: 30% deposit, 70% balance before shipment',
    leadTime: '7–15 days after receipt of deposit and final confirmation of model, color and specifications; subject to order quantity',
    moq: 'Trial order: 2 sets; standard MOQ: 10 sets (negotiable by model)',
    packing: 'Export carton + compressed packaging, where applicable',
    warranty: '12 months from shipment date against manufacturing defects',
    priceBasis: 'Prices are based on the Incoterm and named place stated in this quotation',
    notes: [
      '1. This quotation is valid until the date stated above',
      '2. Product dimensions, packing size, weight and CBM are estimates; final production and loading data shall prevail',
      '3. Unless otherwise stated in writing, prices exclude destination charges, import duties, VAT, unloading and installation',
      '4. Bank details will be stated on the confirmed Proforma Invoice (PI). Any account change must be reconfirmed by phone or video',
    ].join('\n'),
    footer: 'LVANJU  |  Smarter Furniture, Smaller Volume',
    preparedByRole: 'Export Sales',
    unitLabel: 'Set',
    validDays: 15,
  },
  fr: {
    title: 'DEVIS EXPORT MOBILIER',
    companyLine: 'Foshan Shunde Mianxuanhui Furniture Co., Ltd.  |  Marque : LVANJU',
    contactLine: 'Site : lvanju.en.alibaba.com  |  E-mail : 15815694430@163.com  |  WhatsApp : +86 15815694430  |  Adresse : Foshan, Guangdong, Chine 528315',
    paymentTerms: 'T/T : acompte de 30 %, solde de 70 % avant expédition',
    leadTime: '7 à 15 jours après réception de l’acompte et confirmation du modèle, de la couleur et des spécifications, selon la quantité',
    moq: 'Commande d’essai : 2 ensembles ; MOQ standard : 20 ensembles (selon le modèle)',
    packing: 'Carton d’exportation + emballage compressé, le cas échéant',
    warranty: '12 mois à compter de la date d’expédition contre les défauts de fabrication',
    priceBasis: 'Les prix sont basés sur l’Incoterm et le lieu désigné indiqués dans ce devis',
    notes: [
      '1. Ce devis est valable jusqu’à la date indiquée ci-dessus',
      '2. Les dimensions, le poids et le CBM sont estimatifs ; les données finales de production et de chargement prévalent',
      '3. Sauf indication écrite contraire, les prix n’incluent pas les frais à destination, les droits d’importation, la TVA, le déchargement ni l’installation',
      '4. Les coordonnées bancaires figurent sur la facture pro forma (PI) confirmée. Toute modification doit être reconfirmée par téléphone ou vidéo',
    ].join('\n'),
    footer: 'LVANJU  |  Smarter Furniture, Smaller Volume',
    preparedByRole: 'Service export',
    unitLabel: 'Ensemble',
    validDays: 15,
  },
};

/** 金额显示：中文单据用千分位 + 两位小数，币种符号单独放在表头，避免不同语言的货币格式混乱。 */
export function formatAmount(value: number, language: QuoteLanguage) {
  const locale = language === 'zh' ? 'zh-CN' : language === 'fr' ? 'fr-FR' : 'en-US';
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatNumber(value: number, language: QuoteLanguage, digits = 2) {
  const locale = language === 'zh' ? 'zh-CN' : language === 'fr' ? 'fr-FR' : 'en-US';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}
