import { containsPrice } from './quick-replies';

/**
 * 优化话术: the salesperson wrote a line; DeepSeek offers three better ways to say it. These rules check what a model
 * might slip in: facts the salesperson did not write (numbers, prices) and Chinese reaching a foreign customer.
 */
export const POLISH_COUNT = 3;
const CJK = /[㐀-鿿豈-﫿]/;
/** Numbers as people write them: 25, 2026, 140×190 is two numbers, 99,5 and 1.200 count as one. */
const NUMBER = /\d+(?:[.,]\d+)*/g;

/** "Combien ça coûte ?", "price please", "سعر", "多少钱": the customer is asking about price. */
const PRICE_QUESTION = /\b(prix|price|prices|pricing|precio|precios|preço|preços|tarif|tarifs|cost|costs|coûte|combien|how much|quote|devis|cotización)\b|سعر|أسعار|كم|价格|多少钱|报价/i;
export const asksPrice = (text: string) => PRICE_QUESTION.test(text);

const numbersIn = (text: string) => (text.match(NUMBER) ?? []).map(n => n.replace(/[.,]/g, ''));

/**
 * What is wrong with one suggestion, in Chinese for the salesperson and English for the model's second try.
 * allowed: the salesperson's line and the chat, where any number in the suggestion must come from.
 */
export function polishProblems(suggestion: string, allowed: string[], customerWritesChinese: boolean) {
  const problems: { en: string; zh: string }[] = [];
  const known = new Set(allowed.flatMap(numbersIn));
  const invented = [...new Set(numbersIn(suggestion).filter(n => !known.has(n)))];
  if (invented.length) problems.push({ en: `It adds numbers that are not in the salesperson's text or the chat (${invented.join(', ')}). Never add numbers, sizes, quantities, dates or prices.`, zh: `加了原话和聊天里没有的数字（${invented.join('、')}），请核对` });
  if (containsPrice(suggestion) && !allowed.some(containsPrice)) problems.push({ en: 'It mentions a price. Never write prices; the quotation gives them.', zh: '写了价格，价格请用报价单' });
  if (!customerWritesChinese && CJK.test(suggestion)) problems.push({ en: 'It contains Chinese characters. Write only in the customer\'s language.', zh: '里面有中文字符' });
  return problems;
}
