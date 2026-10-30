/**
 * 常用回复 (quick replies): a Chinese text written once, with versions in the customers' languages. Clicking one
 * only fills the input box; {客户名} and {我的名字} are filled from the customer and the salesperson.
 */
export const QUICK_REPLY_CATEGORIES = { LEAD_TIME: '交期', MOQ: '起订量', SHIPPING: '运费', PAYMENT: '付款', INFO: '要资料', OTHER: '其他' } as const;
export type QuickReplyCategory = keyof typeof QUICK_REPLY_CATEGORIES;
export const REPLY_LANGUAGES = { fr: '法语', en: '英语', ar: '阿拉伯语' } as const;
export type ReplyLanguage = keyof typeof REPLY_LANGUAGES;
export const REPLY_VARIABLES = ['{客户名}', '{我的名字}'] as const;
/** How many of the most used replies are marked 最常用. */
export const TOP_REPLIES = 3;

/**
 * Prices never go into a quick reply: they change and must come from a quotation (PROJECT_RULES 业务红线).
 * Catches an amount with a currency next to it, e.g. "$120", "120 USD", "99,5 €", "每件 80 元".
 */
const PRICE = /[$€£¥]\s?\d|\b(?:usd|eur|rmb|cny|aed|sar)\s?\d|\d[\d.,]*\s?(?:[$€£¥]|(?:usd|eur|euros?|dollars?|rmb|cny|aed|sar|dhs?)(?![a-z])|美元|美金|欧元|元)/i;
export const containsPrice = (text: string) => PRICE.test(text);

export type ReplyBodies = Partial<Record<ReplyLanguage, string>>;
/**
 * The text to fill for a customer: their language's version; else English; else the Chinese, flagged so the
 * salesperson translates it before sending.
 */
export function replyFor(reply: { zh: string; bodies: ReplyBodies }, language: string) {
  const own = reply.bodies[language as ReplyLanguage]?.trim();
  if (own) return { text: own, language, missing: false };
  const english = reply.bodies.en?.trim();
  if (english) return { text: english, language: 'en', missing: language !== 'en' };
  return { text: reply.zh, language: 'zh', missing: true };
}

export function fillVariables(text: string, values: { customer: string; me: string }) {
  return text.replaceAll('{客户名}', values.customer).replaceAll('{我的名字}', values.me);
}

/** "/交期", "/运费 港口": every word must appear in the title, the Chinese or the category. */
export function matchesReply(reply: { title: string; zh: string; category: string }, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${reply.title} ${reply.zh} ${QUICK_REPLY_CATEGORIES[reply.category as QuickReplyCategory] ?? ''}`.toLowerCase();
  return words.every(word => haystack.includes(word));
}
