/**
 * Reading ad-form answers whatever the form asks, and in the languages the forms run in: who the buyer is, how much
 * they want and how soon. Meta returns a question as the form's field name ("what_type_of_business_are_you?") and a
 * choice as its key ("furniture_/_mattress_wholesaler_or_distributor", "50–200_pcs", "within_1_month"); a CSV export
 * may carry the visible text instead. The realtime intake, the smart import and the lead grade all read answers here,
 * so a new form with differently worded questions is understood the same way everywhere.
 */

/** Lower case, choice-key underscores as spaces. */
export const plainText = (text: string) => text.toLowerCase().replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

// ───────────────────────── Questions ─────────────────────────

/** "What type of business are you?", "Which best describes your business?", "Vous êtes ?", "客户类型"… */
export const BUYER_QUESTION = /type of (business|company|customer|buyer)|(business|company|customer|buyer) type|kind of business|best describes?|describes? (you|your)|who are you|are you an? |type d.?(entreprise|activit|client)|votre (entreprise|activit)|vous [eê]tes|tipo de (negocio|empresa|cliente)|usted es|نوع (العمل|النشاط|نشاط)|业务类型|客户类型|身份|公司类型/;
/** "How many pieces for your first order?", "Estimated order quantity per model", "Quantité", "采购数量"… */
export const QUANTITY_QUESTION = /quantit|how many (pieces|pcs|units|sets|items|sofas?|beds?|mattress\w*|chairs?|tables?|containers?|products?|models?)|\bpcs\b|\bqty\b|order (size|volume)|estimated order|cantidad|cu[aá]nt[oa]s|combien|كمية|الكمية|数量|多少件|采购量/;
/** "When do you plan to place your order?", "Purchase timeline", "Quand…", "什么时候下单"… */
export const TIMELINE_QUESTION = /when (do|will|would|are|can) you|how soon|time ?(line|frame)|plan(ning)? to (buy|order|purchase|place)|cu[aá]ndo|quand|متى|什么时候|何时|计划.*(下单|采购|购买)/;
const PER_MODEL = /per (model|item|design|style|product)|each (model|item|design)|par mod|por mod|每款|每个型号/;

// ───────────────────────── Answers ─────────────────────────

/** Purchase type codes (lib/constants purchases), plus PROJECT for designers, hotels and contractors. */
const BUYER_WORDS: [string, RegExp][] = [
  ['WHOLESALE', /wholesal|grossiste|mayorista|atacad|批发|جملة/g],
  ['IMPORTER', /import|importateur|importador|进口|مستورد/g],
  ['DISTRIBUTOR', /distribut|经销|代理|موزع|وكيل/g],
  ['ECOMMERCE', /e-?commerce|online|amazon|shopify|en ligne|电商|跨境|متجر إلكتروني/g],
  ['RETAILER', /retail|store|shop|showroom|d[ée]taillant|magasin|boutique|minorista|tienda|零售|门店|家具店|متجر|محل|معرض/g],
  ['BRAND', /\bbrand|marque|marca|品牌|علامة/g],
  ['PROJECT', /interior design|designer|project|contractor|hotel|developer|architect|d[ée]corat|proyecto|projet|酒店|工程|设计|مشاريع|فندق/g],
];
const PERSONAL = /personal|for my (home|house|own)|myself|individual|own use|home use|particulier|usage personnel|uso personal|para mi (casa|hogar)|个人|自用|家用|شخصي/;

/**
 * The buyer type an answer names. When it names several ("Importer / wholesale") the one written first wins: that is
 * usually how the buyer sees themselves. '' when it names none.
 */
export function buyerTypeOf(answer: string): string {
  const text = plainText(answer);
  let best: { key: string; at: number; length: number } | null = null;
  for (const [key, pattern] of BUYER_WORDS) {
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (!best || at < best.at || (at === best.at && match[0].length > best.length)) best = { key, at, length: match[0].length };
    }
  }
  return best?.key ?? '';
}
export const buysForThemselves = (answer: string) => PERSONAL.test(plainText(answer));

/** min: pieces to count with; exact: a single number, fit for the profile's quantity field (a range is not). */
export type Quantity = { min: number | null; container: boolean; label: string; exact: boolean };
const CONTAINER = /container|\b(20|40) ?(gp|hq|ft|')|\d+ ?x ?(20|40)|整柜|货柜|集装箱|conteneur|contenedor|حاوية/;
const AT_MOST = /less than|fewer than|under|below|up to|at most|moins de|menos de|少于|以下|不到|أقل/;

/**
 * A stated quantity. A range counts from its lower end ("50–200_pcs" → 50), "200+" or "more than 200" from 200;
 * "less than 20" says too little to count. A container is a volume of its own.
 */
export function quantityOf(answer: string): Quantity | null {
  const text = plainText(answer);
  const container = CONTAINER.test(text);
  const numbers = [...text.replace(/(\d),(\d{3})/g, '$1$2').matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0])).filter(n => Number.isFinite(n) && n > 0 && n < 1e9);
  if (container) return { min: null, container, label: numbers[0] && !/\b(20|40) ?(gp|hq|ft)/.test(text) ? `${numbers[0]} 个货柜` : '整柜', exact: false };
  if (!numbers.length || AT_MOST.test(text)) return null;
  const min = Math.floor(numbers[0]);
  const ranged = numbers.length > 1 && /\d\s*(-|–|—|~|to|à|a|至|到)\s*\d/.test(text);
  const atLeast = !ranged && /\+|more than|over|above|plus de|más de|以上|أكثر/.test(text);
  const label = ranged ? `${min}–${Math.floor(numbers[1])} 件` : atLeast ? `${min} 件以上` : `${min} 件`;
  return { min, container: false, label, exact: !ranged && !atLeast };
}

/** true: buying within about a month; false: not decided or later; null: cannot tell. */
export function buysSoon(answer: string): boolean | null {
  const text = plainText(answer);
  if (/not (sure|ready|yet)|no rush|just (looking|researching|browsing|comparing)|no plan|undecided|later|next year|[3-9] ?(-|–|to) ?\d+ months|more than|over \d|pas encore|plus tard|pas s[uû]r|no s[eé]|todav[ií]a|m[aá]s adelante|不确定|以后|看看|暂不|لاحقا|غير متأكد/.test(text)) return false;
  if (/immediate|asap|right now|ready|urgent|this (week|month)|within (a |one |1 |2 |two )?(week|weeks|month)|1 ?(-|–|to) ?2 weeks|next (week|month)|imm[eé]diat|ce mois|dans (le|un) mois|cette semaine|inmediat|este mes|en un mes|esta semana|立即|马上|尽快|本周|本月|一个月内|1个月内|فور|هذا الشهر|خلال شهر/.test(text)) return true;
  return null;
}

export type AnswerPair = { question: string; answer: string };
export type AnswerSignals = {
  /** A purchase type code, PROJECT, or '' */
  buyer: string;
  personal: boolean;
  quantity: (Quantity & { perModel: boolean }) | null;
  /** The answer to the timeline question, as written (choice keys made readable). */
  timeline: string;
  soon: boolean | null;
};

/** Everything the answers of one form say about the buyer. Questions are recognised by their wording, not by name. */
export function readAnswers(pairs: AnswerPair[]): AnswerSignals {
  const asked = (pattern: RegExp) => pairs.filter(p => pattern.test(plainText(p.question)));
  const buyerAnswers = asked(BUYER_QUESTION);
  // The buyer question first; on a form that words it differently, any answer that names a buyer type.
  const buyer = buyerAnswers.map(p => buyerTypeOf(p.answer)).find(Boolean)
    || pairs.filter(p => !TIMELINE_QUESTION.test(plainText(p.question))).map(p => buyerTypeOf(p.answer)).find(Boolean) || '';
  const personal = (buyerAnswers.length ? buyerAnswers : pairs).some(p => buysForThemselves(p.answer));
  let quantity: AnswerSignals['quantity'] = null;
  for (const p of asked(QUANTITY_QUESTION)) {
    const parsed = quantityOf(p.answer);
    if (!parsed) continue;
    // "How many containers?" counts containers, not pieces.
    const containers = CONTAINER.test(plainText(p.question)) && !parsed.container;
    quantity = { ...(containers ? { min: null, container: true, label: `${parsed.min} 个货柜`, exact: false } : parsed), perModel: PER_MODEL.test(plainText(p.question)) };
    break;
  }
  const timelineAnswer = asked(TIMELINE_QUESTION)[0];
  return { buyer, personal: personal && !['WHOLESALE', 'IMPORTER', 'DISTRIBUTOR'].includes(buyer), quantity,
    timeline: timelineAnswer ? plainText(timelineAnswer.answer).slice(0, 100) : '', soon: timelineAnswer ? buysSoon(timelineAnswer.answer) : null };
}
