/**
 * 客户列表可以显示的列。每位用户在「定制列」里挑选、排序，保存在 UserViewPreference（view = customers），
 * 只改变本人看到的列表，不影响数据权限和其他同事。
 *
 * 列键同时是列表的排序参数（?sort=）：可排序的列必须是 Customer 字段，
 * 或 customer-list-service 单独处理的 owner（负责人姓名）/ deals（成交笔数）。
 */
export const CUSTOMER_COLUMN_GROUPS = [
  { key: 'profile', label: '客户资料' },
  { key: 'contact', label: '联系方式' },
  { key: 'sales', label: '销售进度' },
  { key: 'timeline', label: '跟进与时间' },
  { key: 'source', label: '来源与负责人' },
] as const;
export type CustomerColumnGroup = (typeof CUSTOMER_COLUMN_GROUPS)[number]['key'];

type ColumnDef = { label: string; group: CustomerColumnGroup; sortable: boolean; locked?: boolean };

export const CUSTOMER_COLUMNS = {
  // 客户列固定在第一列：点名字进档案，点这一列其他位置打开右侧预览。
  name: { label: '客户 / 公司', group: 'profile', sortable: true, locked: true },
  companyName: { label: '公司', group: 'profile', sortable: true },
  country: { label: '国家', group: 'profile', sortable: true },
  city: { label: '城市', group: 'profile', sortable: true },
  language: { label: '沟通语言', group: 'profile', sortable: true },
  purchaseType: { label: '采购类型', group: 'profile', sortable: true },
  productInterest: { label: '意向产品', group: 'profile', sortable: true },
  productModel: { label: '型号', group: 'profile', sortable: true },
  quantity: { label: '采购数量', group: 'profile', sortable: true },
  purchaseTimeline: { label: '采购计划', group: 'profile', sortable: true },
  notes: { label: '备注', group: 'profile', sortable: false },
  whatsapp: { label: 'WhatsApp', group: 'contact', sortable: true },
  phone: { label: '电话', group: 'contact', sortable: true },
  email: { label: '邮箱', group: 'contact', sortable: true },
  stage: { label: '阶段', group: 'sales', sortable: true },
  isQualified: { label: '有效性', group: 'sales', sortable: true },
  leadGrade: { label: '表单等级', group: 'sales', sortable: true },
  estimatedOrderValue: { label: '预计金额', group: 'sales', sortable: true },
  budget: { label: '预算', group: 'sales', sortable: true },
  quotedAmount: { label: '报价金额', group: 'sales', sortable: true },
  deals: { label: '成交笔数', group: 'sales', sortable: true },
  aiScore: { label: 'AI 评分', group: 'sales', sortable: true },
  // 进线时间：线索第一次进入系统的时刻（Customer.inquiryAt，lib/entry-time），带客户当地时间和「工作时间外」。
  inquiryAt: { label: '进线时间', group: 'timeline', sortable: true },
  createdAt: { label: '录入时间', group: 'timeline', sortable: true },
  contactedAt: { label: '首次联系', group: 'timeline', sortable: true },
  firstReplyAt: { label: '首次回复', group: 'timeline', sortable: true },
  quotedAt: { label: '首次报价', group: 'timeline', sortable: true },
  lastFollowUpAt: { label: '最后跟进', group: 'timeline', sortable: true },
  nextFollowUpAt: { label: '下次跟进', group: 'timeline', sortable: true },
  lastWhatsAppAt: { label: '最近 WhatsApp', group: 'timeline', sortable: true },
  source: { label: '来源', group: 'source', sortable: true },
  sourceDetail: { label: '来源详情（广告 / 活动）', group: 'source', sortable: true },
  owner: { label: '负责人', group: 'source', sortable: true },
} as const satisfies Record<string, ColumnDef>;

export type CustomerColumnKey = keyof typeof CUSTOMER_COLUMNS;
const columnDef = (key: CustomerColumnKey): ColumnDef => CUSTOMER_COLUMNS[key];

export const CUSTOMER_COLUMN_KEYS = Object.keys(CUSTOMER_COLUMNS) as [CustomerColumnKey, ...CustomerColumnKey[]];
export const CUSTOMER_SORT_KEYS = CUSTOMER_COLUMN_KEYS.filter(key => columnDef(key).sortable) as [CustomerColumnKey, ...CustomerColumnKey[]];

/** 没有自定义过的用户看到的列，也是「恢复默认列」的结果（与定制列上线前的列表一致）。 */
export const DEFAULT_CUSTOMER_COLUMNS: readonly CustomerColumnKey[] = [
  'name', 'inquiryAt', 'country', 'source', 'whatsapp', 'stage', 'isQualified', 'estimatedOrderValue', 'lastFollowUpAt', 'nextFollowUpAt', 'owner',
];

export const isCustomerColumn = (key: string): key is CustomerColumnKey => Object.prototype.hasOwnProperty.call(CUSTOMER_COLUMNS, key);
export const isLockedColumn = (key: CustomerColumnKey) => !!columnDef(key).locked;

/**
 * 去掉不认识的列（例如以后下线的列）和重复项，固定列放回第一位。
 * 一列都不认识时回到默认列，保证列表永远有内容。
 */
export function normalizeCustomerColumns(keys: readonly string[] | null | undefined): CustomerColumnKey[] {
  const known = (keys ?? []).filter(isCustomerColumn);
  if (!known.length) return [...DEFAULT_CUSTOMER_COLUMNS];
  const locked = CUSTOMER_COLUMN_KEYS.filter(isLockedColumn);
  return [...locked, ...new Set(known.filter(key => !isLockedColumn(key)))];
}

export const sameColumns = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, i) => key === b[i]);
