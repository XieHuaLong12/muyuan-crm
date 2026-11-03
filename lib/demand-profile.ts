import { buyerTypeOf, buysForThemselves, plainText } from './lead-answers';
import { purchases } from './constants';
import type { ScriptLanguage } from './outreach';

/**
 * 需求画像 (docs/METRICS.md §需求画像): what a customer wants, in the fields a quotation and the country card need.
 * Rules here read the customer's own words; AI may add to them in services/demand-profile-service, but every value
 * must quote what the customer actually wrote. Nothing counts until a person confirms it.
 */
export const DEMAND_FIELDS = {
  buyer: '买家类型',
  category: '品类',
  size: '尺寸',
  quantity: '数量',
  packaging: '包装',
  port: '目的港',
  deadline: '要求到货',
  budget: '客户提到的价格',
  certification: '认证要求',
  incoterm: '贸易条款',
} as const;
export type DemandField = keyof typeof DEMAND_FIELDS;
export const DEMAND_KEYS = Object.keys(DEMAND_FIELDS) as DemandField[];
export const isDemandField = (key: string): key is DemandField => Object.prototype.hasOwnProperty.call(DEMAND_FIELDS, key);
/** What a quotation cannot be made without. Prices, MOQ and lead time come from the product library, never from here. */
export const QUOTE_NEEDS: readonly DemandField[] = ['size', 'quantity', 'port'];
/** Fields whose numbers must appear in the quoted words (an AI value may not invent a size, a quantity or a price). */
export const NUMERIC_FIELDS: readonly DemandField[] = ['size', 'quantity', 'budget'];

export type Source = { text: string; at: Date | null };
export type Found = { field: DemandField; value: string; evidence: string; at: Date | null };

/** The words around a match, so a person can see where a value came from (at most ~120 characters). */
export function excerpt(text: string, index: number, length: number) {
  const start = Math.max(0, index - 40), end = Math.min(text.length, index + length + 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

const MONTHS: [RegExp, number][] = [
  [/janv|january|enero|يناير/i, 1], [/f[ée]v|february|febrero|فبراير/i, 2], [/mars|march|marzo|مارس/i, 3], [/avr|april|abril|أبريل|ابريل/i, 4],
  [/\bmai\b|\bmay\b|mayo|ماي|مايو/i, 5], [/juin|june|junio|يونيو/i, 6], [/juil|july|julio|يوليو/i, 7], [/ao[uû]t|august|agosto|أغسطس|غشت/i, 8],
  [/sept|septiembre|سبتمبر/i, 9], [/oct|octubre|أكتوبر/i, 10], [/nov|noviembre|نوفمبر/i, 11], [/d[ée]c|diciembre|ديسمبر/i, 12],
];
const MONTH_WORD = 'janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre|january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre';

const PORTS: [RegExp, string][] = [
  [/le havre|\bhavre\b/i, '勒阿弗尔（Le Havre）'], [/marseille|\bfos\b/i, '马赛（Marseille）'], [/dunkerque|dunkirk/i, '敦刻尔克（Dunkerque）'],
  [/anvers|antwerp|antwerpen/i, '安特卫普（Antwerp）'], [/rotterdam/i, '鹿特丹（Rotterdam）'], [/hamburg|hambourg/i, '汉堡（Hamburg）'],
  [/valencia|valence\b/i, '瓦伦西亚（Valencia）'], [/barcelon/i, '巴塞罗那（Barcelona）'], [/genova|g[eê]nes|genoa/i, '热那亚（Genova）'],
  [/tanger ?med|tanger|tangier/i, '丹吉尔（Tanger Med）'], [/casablanca|casa port/i, '卡萨布兰卡（Casablanca）'], [/agadir/i, '阿加迪尔（Agadir）'],
  [/abidjan/i, '阿比让（Abidjan）'], [/dakar/i, '达喀尔（Dakar）'], [/lom[ée]\b/i, '洛美（Lomé）'], [/cotonou/i, '科托努（Cotonou）'],
  [/douala/i, '杜阿拉（Douala）'], [/libreville|owendo/i, '利伯维尔（Libreville）'], [/pointe[- ]noire/i, '黑角（Pointe-Noire）'],
  [/alger\b|algiers/i, '阿尔及尔（Alger）'], [/rad[eè]s|tunis\b/i, '拉德斯（Radès）'], [/jeddah|djeddah/i, '吉达（Jeddah）'],
  [/jebel ali|dubai|duba[iï]/i, '迪拜（Jebel Ali）'], [/\blagos\b|apapa/i, '拉各斯（Lagos）'], [/\btema\b/i, '特马（Tema）'],
  [/conakry/i, '科纳克里（Conakry）'], [/nouakchott/i, '努瓦克肖特（Nouakchott）'], [/r[ée]union|port des galets/i, '留尼汪（Port Réunion）'],
];

const CATEGORY: [RegExp, string][] = [
  [/canap[ée][- ]lit|sofa[- ]?bed|clic[- ]?clac|schlafsofa|sof[aá] cama|沙发床/i, '沙发床'],
  [/ressorts? ensach[ée]s?|pocket(ed)? springs?|muelles ensacados|独立袋装/i, '独立袋装弹簧床垫'],
  [/matelas|mattress|colch[oó]n|床垫|مرتب|فرشة/i, '床垫'],
  [/canap[ée]|\bsofas?\b|sof[aá]s?|沙发|كنب|صالون/i, '沙发'],
  [/sommier|bed ?base|box ?spring|床架|床箱/i, '床架 / 床箱'],
  [/\blits?\b(?! de)|\bbeds?\b|\bcamas?\b|سرير/i, '床'],
  [/chaises?|chairs?|sillas?|椅/i, '椅子'],
];

const PACKAGING: [RegExp, string][] = [
  [/roul[ée]|rolled|roll[- ]?pack|sous[- ]vide|vacuum|compress|enrollad|卷包|压缩|ملفوف|مضغوط/i, '卷包（压缩）'],
  [/[àa] plat\b|flat[- ]?pack|non roul|不卷|平包/i, '平板包装'],
];

const CERTS = /\b(oeko[- ]?tex|certipur(?:-us)?|reach|fsc|bs ?7177|ca ?117|en ?597|iso ?9001|ce mark(?:ing)?)\b/gi;
const INCOTERM = /\b(fob|cif|cfr|c&f|exw|ddp|dap)\b/i;
const SIZE = /(\d{2,3})\s*(?:cm)?\s*[x×*X]\s*(\d{2,3})(?:\s*(?:cm)?\s*[x×*X]\s*(\d{1,2}))?/;
const QUANTITY = /(\d{1,5})\s*(pcs|pi[eè]ces?|pieces?|pc\b|unit[ée]s?|units?|sets?|ensembles?|件|张|套|piezas|unidades|قطعة|قطع)/i;
const CONTAINER = /(\d+)?\s*(?:x\s*)?(40|20)\s*(?:ft|'|pieds|hq|gp|hc|尺)|conteneurs?|containers?|整柜|货柜|حاوية/i;
const MONEY = /(?:(€|eur|euros?|\$|usd|dollars?|mad|dhs?|dirhams?|fcfa|xof|cfa)\s*(\d{1,6}(?:[.,]\d{1,2})?)|(\d{1,6}(?:[.,]\d{1,2})?)\s*(€|eur\b|euros?|\$|usd|dollars?|mad|dhs?\b|dirhams?|fcfa|xof|cfa))/i;
const PRICE_CONTEXT = /budget|prix|price|precio|tarif|co[uû]t|cost|par pi[eè]ce|per (piece|pc|unit)|chacun|each|l'unit[ée]|la pi[eè]ce|ailleurs|elsewhere|السعر|ثمن|预算|价/i;
const DEADLINE = new RegExp(`(avant|before|by|d'ici|until|jusqu'?[àa]|para|antes de)\\s+(?:la |le |l'|el |the )?(mi-?|fin |d[ée]but |mid-?|end of |early |late |finales de |mediados de |principios de )?(${MONTH_WORD})`, 'i');
const WITHIN = /(dans|within|in|d'ici|en)\s+(\d{1,2})\s*(jours|days|semaines|weeks|mois|months|d[ií]as|semanas|meses)/i;

const currencySymbol = (raw: string) => /€|eur/i.test(raw) ? '€' : /\$|usd|dollar/i.test(raw) ? '$' : /mad|dh|dirham/i.test(raw) ? 'MAD ' : /cfa|xof/i.test(raw) ? 'FCFA ' : '';

function deadlineValue(text: string) {
  const m = text.match(DEADLINE);
  if (m) {
    const month = MONTHS.find(([pattern]) => pattern.test(m[3]))?.[1];
    if (!month) return null;
    const part = !m[2] ? '' : /mi|mid|mediados/i.test(m[2]) ? '中旬' : /fin|end|late|finales/i.test(m[2]) ? '底' : '初';
    return { value: `${month} 月${part}前`, index: m.index ?? 0, length: m[0].length };
  }
  const w = text.match(WITHIN);
  if (!w) return null;
  const unit = /jour|day|d[ií]a/i.test(w[3]) ? '天' : /semaine|week|semana/i.test(w[3]) ? '周' : '个月';
  return { value: `${w[2]} ${unit}内`, index: w.index ?? 0, length: w[0].length };
}

/**
 * Values the rules can read from what the customer wrote (their messages, oldest first, then the form answers).
 * The newest mention of a field wins: a customer who changes 140×190 to 160×200 meant the latter.
 */
export function ruleDemand(sources: Source[], form: { answers: string[]; at: Date | null } | null = null): Found[] {
  const found = new Map<DemandField, Found>();
  const put = (field: DemandField, value: string, s: Source, index: number, length: number) =>
    found.set(field, { field, value: value.slice(0, 200), evidence: excerpt(s.text, index, length), at: s.at });
  const all: Source[] = [...(form ? form.answers.map(text => ({ text, at: form.at })) : []), ...sources];
  for (const s of all) {
    const text = s.text;
    if (!text.trim()) continue;
    const buyer = buyerTypeOf(text);
    if (buyer) { const m = plainText(text); put('buyer', purchases[buyer as keyof typeof purchases] ?? buyer, { ...s, text }, 0, Math.min(m.length, 60)); }
    else if (buysForThemselves(text)) put('buyer', '个人（自用）', s, 0, Math.min(text.length, 60));
    for (const [pattern, label] of CATEGORY) { const m = text.match(pattern); if (m) { put('category', label, s, m.index ?? 0, m[0].length); break; } }
    const size = text.match(SIZE);
    if (size) put('size', `${size[1]}×${size[2]}${size[3] ? `×${size[3]}` : ''}`, s, size.index ?? 0, size[0].length);
    const container = text.match(CONTAINER);
    const quantity = text.match(QUANTITY);
    if (quantity && !(size && quantity.index === (size.index ?? 0))) put('quantity', `${quantity[1]} 件`, s, quantity.index ?? 0, quantity[0].length);
    else if (container) put('quantity', container[2] ? `${container[1] ? `${container[1]} × ` : ''}${container[2]} 尺柜` : '整柜', s, container.index ?? 0, container[0].length);
    for (const [pattern, label] of PACKAGING) { const m = text.match(pattern); if (m) { put('packaging', label, s, m.index ?? 0, m[0].length); break; } }
    for (const [pattern, label] of PORTS) { const m = text.match(pattern); if (m) { put('port', label, s, m.index ?? 0, m[0].length); break; } }
    const deadline = deadlineValue(text);
    if (deadline) put('deadline', deadline.value, s, deadline.index, deadline.length);
    const money = text.match(MONEY);
    if (money && PRICE_CONTEXT.test(text)) {
      const symbol = currencySymbol(money[1] ?? money[4] ?? ''), amount = (money[2] ?? money[3]).replace(',', '.');
      put('budget', `约 ${symbol}${amount}`, s, money.index ?? 0, money[0].length);
    }
    const certs = [...new Set([...text.matchAll(CERTS)].map(m => m[1].toUpperCase().replace(/\s+/g, ' ')))];
    if (certs.length) { const first = text.search(CERTS); put('certification', certs.join('、'), s, first, certs.join(' ').length); }
    const incoterm = text.match(INCOTERM);
    if (incoterm) put('incoterm', incoterm[1].toUpperCase().replace('C&F', 'CFR'), s, incoterm.index ?? 0, incoterm[0].length);
  }
  return DEMAND_KEYS.flatMap(key => found.get(key) ?? []);
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * Whether an AI-read value stands on the customer's words: the quote must be in one of their messages (or form
 * answers), and for sizes, quantities and prices every number in the value must be in the quote.
 */
export function supported(field: DemandField, value: string, quote: string, texts: string[]) {
  const q = squash(quote);
  if (q.length < 2 || !value.trim()) return false;
  if (!texts.some(text => squash(text).includes(q))) return false;
  if (!NUMERIC_FIELDS.includes(field)) return true;
  return (value.match(/\d+(?:[.,]\d+)?/g) ?? []).every(n => q.includes(n) || q.includes(n.replace('.', ',')));
}

/** One short question for what is still missing (at most two fields), in the customer's language; the person sends it. */
const QUESTIONS: Record<ScriptLanguage, Partial<Record<DemandField, string>>> = {
  fr: {
    size: 'Quelles dimensions vous intéressent (par ex. 140×190, 160×200) ?', quantity: 'Quelle quantité envisagez-vous pour la première commande ?',
    port: 'Quel est votre port de destination ?', incoterm: 'Vous préférez un prix FOB ou CIF jusqu\'à votre port ?',
    certification: 'Avez-vous besoin d\'une certification particulière (OEKO-TEX, CertiPUR…) ?', deadline: 'Pour quand souhaitez-vous recevoir la marchandise ?',
    packaging: 'Vous préférez un emballage roulé (sous vide) ou à plat ?',
  },
  en: {
    size: 'Which sizes are you interested in (e.g. 140×190, 160×200)?', quantity: 'What quantity are you planning for the first order?',
    port: 'What is your destination port?', incoterm: 'Do you prefer an FOB price or CIF to your port?',
    certification: 'Do you need any specific certification (OEKO-TEX, CertiPUR…)?', deadline: 'When would you like to receive the goods?',
    packaging: 'Do you prefer rolled (vacuum) packing or flat packing?',
  },
  ar: {
    size: 'ما المقاسات التي تهمكم (مثلاً 140×190 أو 160×200)؟', quantity: 'ما الكمية التي تخططون لها في الطلب الأول؟',
    port: 'ما هو ميناء الوصول لديكم؟', incoterm: 'هل تفضلون السعر FOB أم CIF حتى ميناءكم؟',
    certification: 'هل تحتاجون إلى شهادة معينة (مثل OEKO-TEX أو CertiPUR)؟', deadline: 'متى تريدون استلام البضاعة؟',
    packaging: 'هل تفضلون التغليف الملفوف (مضغوط) أم المسطح؟',
  },
};
const QUESTIONS_ZH: Partial<Record<DemandField, string>> = {
  size: '您需要哪些尺寸（比如 140×190、160×200）？', quantity: '首单打算要多少件？', port: '目的港是哪里？', incoterm: '报价要 FOB 还是 CIF 到您的港口？',
  certification: '需要什么认证吗（OEKO-TEX、CertiPUR 等）？', deadline: '希望什么时候收到货？', packaging: '要卷包（压缩）还是平板包装？',
};
const ASK_ORDER: DemandField[] = ['size', 'quantity', 'port', 'incoterm', 'certification', 'deadline', 'packaging'];
export function missingQuestion(known: Set<DemandField>, language: ScriptLanguage) {
  const ask = ASK_ORDER.filter(field => !known.has(field)).slice(0, 2);
  if (!ask.length) return null;
  return { fields: ask, text: ask.map(field => QUESTIONS[language][field]).join(' '), zh: ask.map(field => QUESTIONS_ZH[field]).join('') };
}

/**
 * 流失原因 a person picks when a customer is lost (the same list as the stage control), pre-picked from what the
 * customer wrote: the reason, the words it rests on, and a competitor's price when they named one.
 */
export const LOSS_REASONS = ['价格太高', '运费太贵', '起订量太高', '选了别家', '交期不合适', '不再回复', '其他'] as const;
const LOSS_WORDS: [(typeof LOSS_REASONS)[number], RegExp][] = [
  ['运费太贵', /(shipping|freight|transport|livraison|fret|env[ií]o|运费|الشحن).{0,40}(cher|expensive|high|[ée]lev|caro|贵|غال)|(cher|expensive|caro).{0,20}(shipping|freight|transport|livraison|fret)/i],
  ['价格太高', /trop cher|c'est cher|too (expensive|high|pricey)|price is (high|too)|prix (trop )?[ée]lev|muy caro|demasiado caro|غالي|غالية|太贵|价格高|moins cher|cheaper/i],
  ['起订量太高', /minimum|moq|quantit[ée] minimale|cantidad m[ií]nima|起订|الحد الأدنى/i],
  ['选了别家', /autre fournisseur|another supplier|other supplier|d[ée]j[àa] (achet|command|trouv)|already (bought|ordered|found)|otro proveedor|ailleurs|elsewhere|别家|مورد آخر/i],
  ['交期不合适', /d[ée]lai|lead ?time|delivery time|too long|trop long|plazo|tiempo de entrega|交期|太久|مدة التسليم/i],
];
export function lossHint(inbound: Source[], quietDays: number | null) {
  for (const s of [...inbound].reverse()) {
    for (const [reason, pattern] of LOSS_WORDS) {
      const m = s.text.match(pattern);
      if (!m) continue;
      const money = s.text.match(MONEY);
      const competitorPrice = money && /ailleurs|elsewhere|autre|another|other|otro|别家|آخر/i.test(s.text)
        ? `${currencySymbol(money[1] ?? money[4] ?? '')}${(money[2] ?? money[3]).replace(',', '.')}` : '';
      return { reason, quote: excerpt(s.text, m.index ?? 0, m[0].length), at: s.at, competitorPrice };
    }
  }
  if (quietDays !== null && quietDays >= 14) return { reason: '不再回复' as const, quote: `我们最后一条消息后 ${quietDays} 天没有回复`, at: null, competitorPrice: '' };
  return null;
}
/** The reason a saved stage note starts with (「价格太高：别家 €72」 → 价格太高); '' when it is free text. */
export const lossReasonOf = (note: string) => LOSS_REASONS.find(reason => note.startsWith(reason)) ?? (note.trim() ? '其他' : '');
