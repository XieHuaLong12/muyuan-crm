/**
 * Chinese labels for BOS codes. Same values as the PC system:
 * lib/constants.ts (stages, sources, purchase types, follow-up types), lib/order-status.ts, lib/task-meta.ts.
 * Keep in sync when BOS adds a value; an unknown code is shown as-is rather than hidden.
 */
export const STAGES: Record<string, string> = {
  'NEW': '新线索', 'CONTACTED': '已联系', 'REPLIED': '已回复', 'CATALOG_SENT': '已发目录', 'NEEDS_CONFIRMED': '已确认需求',
  'PRODUCT_CONFIRMED': '已确认款式', 'QUOTED': '已报价', 'FOLLOW_UP': '跟进中', 'ORDER': '确认采购', 'WON': '已成交',
  'PAUSED': '暂不需要', 'LOST': '已流失', 'INVALID': '无效客户'
};

export const SOURCES: Record<string, string> = {
  'FACEBOOK': 'Facebook', 'META_CLICK_TO_WHATSAPP': 'Meta 点击 WhatsApp', 'TIKTOK': 'TikTok', 'INSTAGRAM': 'Instagram',
  'ALIBABA': 'Alibaba', 'WEBSITE': '官网', 'WHATSAPP': 'WhatsApp', 'EXHIBITION': '展会', 'REFERRAL': '转介绍',
  'OUTBOUND': '主动开发', 'OTHER': '其他'
};

export const PURCHASES: Record<string, string> = {
  'WHOLESALE': '批发商', 'IMPORTER': '进口商', 'DISTRIBUTOR': '经销商', 'RETAILER': '家具零售', 'BRAND': '品牌客户',
  'ECOMMERCE': '电商客户', 'OTHER': '其他'
};

/** Follow-up channels accepted by POST /api/customers/:id/followups (lib/validation.ts followSchema). */
export const FOLLOW_TYPES: Record<string, string> = {
  'WHATSAPP': 'WhatsApp', 'PHONE': '电话', 'EMAIL': '邮件', 'FACEBOOK': 'Facebook', 'MEETING': '会议', 'OTHER': '其他'
};
export const FOLLOW_TYPE_KEYS: string[] = ['WHATSAPP', 'PHONE', 'EMAIL', 'FACEBOOK', 'MEETING', 'OTHER'];

export const ORDER_STAGES: string[] = ['下单', '付款', '生产', '发货', '运输', '清关', '收货'];
/** status → index of the last completed stage (lib/order-status.ts STATUS_STAGE). */
export const STATUS_STAGE: Record<string, number> = {
  'PENDING_PAYMENT': 0, 'PRODUCING': 2, 'SHIPPED': 3, 'IN_TRANSIT': 4, 'COMPLETED': 6
};

export const TASK_SOURCES: Record<string, string> = {
  'CRM': 'CRM', 'WORKFLOW': '自动跟进', 'ORDER': '订单', 'FINANCE': '财务', 'ADS': '广告', 'AI': 'AI', 'MANUAL': '手动'
};

/** Stages that end the sales work (lib/constants.ts TERMINAL_STAGES). */
export const TERMINAL_STAGES: string[] = ['WON', 'LOST', 'INVALID', 'PAUSED'];

export function label(map: Record<string, string>, code: string): string {
  const value = map[code];
  return value === undefined ? code : value;
}

/** Badge tone for a customer stage (same colours as the prototype). */
export function stageTone(stage: string): string {
  if (stage === 'WON') return 'success';
  if (stage === 'QUOTED' || stage === 'FOLLOW_UP') return 'info';
  if (stage === 'PAUSED') return 'warning';
  if (stage === 'INVALID' || stage === 'LOST') return 'neutral';
  return 'brand';
}

export function orderTone(status: string): string {
  if (status === 'PENDING_PAYMENT') return 'warning';
  if (status === 'PRODUCING') return 'info';
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED') return 'neutral';
  return 'brand';
}

export function paymentTone(payment: string): string {
  if (payment === 'PAID') return 'success';
  if (payment === 'DEPOSIT_PAID') return 'warning';
  return 'danger';
}
