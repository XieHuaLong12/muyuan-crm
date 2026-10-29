export const stages = { NEW:'新线索',CONTACTED:'已联系',REPLIED:'已回复',NEEDS_CONFIRMED:'已确认需求',QUOTED:'已报价',FOLLOW_UP:'跟进中',WON:'已成交',PAUSED:'暂不需要',INVALID:'无效客户',ORDER:'确认采购',LOST:'已流失',CATALOG_SENT:'已发目录',PRODUCT_CONFIRMED:'已确认款式' } as const;
export const sources = { FACEBOOK:'Facebook',META_CLICK_TO_WHATSAPP:'Meta 点击 WhatsApp',TIKTOK:'TikTok',INSTAGRAM:'Instagram',ALIBABA:'Alibaba',WEBSITE:'官网',WHATSAPP:'WhatsApp',EXHIBITION:'展会',REFERRAL:'转介绍',OUTBOUND:'主动开发',OTHER:'其他' } as const;
export const purchases = {WHOLESALE:'批发商',IMPORTER:'进口商',DISTRIBUTOR:'经销商',RETAILER:'家具零售',BRAND:'品牌客户',ECOMMERCE:'电商客户',OTHER:'其他'};
export const followTypes = {WHATSAPP:'WhatsApp',PHONE:'电话',EMAIL:'邮件',FACEBOOK:'Facebook',MEETING:'会议',OTHER:'其他'};
export const invalidReasons = ['零售客户','无采购需求','联系方式无效','垃圾询盘','重复客户','非目标市场','其他'];
export type Stage = keyof typeof stages;
export const pipeline = Object.keys(stages).slice(0,7) as Stage[];
/** An ad lead submitted within this many hours is "fresh": short first-contact deadline, repeat-submission alerts. */
export const AD_LEAD_FRESH_HOURS = 24;
/** Stages where a customer needs no further sales work. */
export const TERMINAL_STAGES = ['WON', 'LOST', 'INVALID', 'PAUSED'] as const;
export const isTerminalStage = (stage: string) => (TERMINAL_STAGES as readonly string[]).includes(stage);
/** Stages that only a real buyer reaches: from a quotation onwards. */
export const ADVANCED_STAGES = ['QUOTED', 'FOLLOW_UP', 'ORDER', 'WON'] as const;
/**
 * From 已回复 to 确认采购 a customer is valid (有效) without anyone ticking it: every stage change into one of these
 * marks the customer valid. 已成交 is always valid on its own; leaving these stages keeps the judgement.
 */
export const QUALIFYING_STAGES = ['REPLIED', 'CATALOG_SENT', 'NEEDS_CONFIRMED', 'PRODUCT_CONFIRMED', 'QUOTED', 'FOLLOW_UP', 'ORDER'] as const;
export const stageQualifies = (stage: string) => (QUALIFYING_STAGES as readonly string[]).includes(stage);
/**
 * Product lines named in the first-touch WhatsApp templates ({{3}} in lvanju_hi_* / lvanju_first_*): the English
 * wording the customer saw in the ad, and the label salespeople pick from when the lead does not say which line.
 */
export const FIRST_TOUCH_PRODUCT_LINES = [
  { value: 'compressed sofas', label: '压缩沙发' },
  { value: 'vacuum-packed mattresses', label: '真空压缩床垫' },
  { value: 'smart electric mattresses', label: '智能电动床垫' },
] as const;
