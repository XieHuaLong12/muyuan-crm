import { purchases } from '@/lib/constants';

/**
 * Facebook 表单问题 → CRM 字段映射。
 *
 * Meta 的 field_data 用表单内部字段名（name）返回，不同表单的命名可能不同，
 * 因此这里按**关键词**匹配 name 与问题文本（label），而不是写死某个字段名。
 * 匹配不到的内容一律进 notes，并保留完整 JSON 原文。
 */

/** Facebook 表单问题里的关键词 → CRM 目标字段。顺序即优先级。 */
const RULES: { target: string; keywords: string[] }[] = [
  { target: 'companyName', keywords: ['company', 'company name', 'business name', '公司'] },
  { target: 'name', keywords: ['full name', 'full_name', 'your name', 'name', '姓名'] },
  { target: 'email', keywords: ['email', 'e-mail', '邮箱'] },
  { target: 'whatsapp', keywords: ['whatsapp', 'whats app', '沃次'] },
  { target: 'phone', keywords: ['phone', 'mobile', 'telephone', '电话'] },
  { target: 'purchaseType', keywords: ['best describes your business', 'business type', 'business?', '业务类型', 'describe your business'] },
  { target: 'country', keywords: ['market or country', 'which market', 'country', 'market', '国家', '市场'] },
  { target: 'quantity', keywords: ['order quantity', 'quantity per model', 'estimated order', '数量'] },
  { target: 'productInterest', keywords: ['compressed', 'roll-packed', 'roll packed', 'interested in', 'product interest'] },
  { target: 'notes:import', keywords: ['import furniture from china', 'do you currently import', '是否进口'] },
  { target: 'notes:concern', keywords: ['main concern', 'concern when sourcing', '顾虑', '担心'] },
];

export type LeadField = { name: string; label: string; value: string };

export type MappedLead = {
  name: string;
  companyName: string;
  country: string;
  phone: string;
  whatsapp: string;
  email: string;
  purchaseType: string;
  productInterest: string;
  quantity: number | null;
  notes: string;
  /** 未识别的问题，原样保留在备注里 */
  extras: { label: string; value: string }[];
};

/**
 * 把「What best describes your business?」的自由文本归一到 CRM 的采购类型枚举。
 *
 * 一个答案可能命中多个类别（例如「Importer / wholesale」）。
 * 按**关键词在答案里出现的位置**取最靠前的那个 —— 那通常是受访者自己的首要身份，
 * 比固定表顺序更合理，也避免「先写 wholesale 就永远归到批发商」这类隐性偏差。
 */
function toPurchaseType(value: string): string {
  const text = value.toLowerCase();
  const table: [string, string[]][] = [
    ['WHOLESALE', ['wholesale', '批发']],
    ['IMPORTER', ['import', '进口']],
    ['DISTRIBUTOR', ['distribut', '经销']],
    ['RETAILER', ['retail', 'furniture store', '零售', '门店']],
    ['BRAND', ['brand', '品牌']],
    ['ECOMMERCE', ['e-commerce', 'ecommerce', 'online', '电商', '跨境']],
  ];
  let best: { key: string; at: number } | null = null;
  for (const [key, words] of table) {
    for (const word of words) {
      const at = text.indexOf(word);
      if (at === -1) continue;
      if (!best || at < best.at) best = { key, at };
    }
  }
  // 认不出来就保持 OTHER，不猜测
  return best?.key ?? 'OTHER';
}

function toQuantity(value: string): number | null {
  // 「100-500」这类区间取上限；纯数字直接用；「More than 1000」取数字
  const numbers = value.match(/\d[\d,]*/g);
  if (!numbers?.length) return null;
  const parsed = numbers.map(n => Number(n.replace(/,/g, ''))).filter(n => Number.isFinite(n) && n >= 0);
  return parsed.length ? Math.max(...parsed) : null;
}

/** 判断一条 field_data 命中了哪条规则（先匹配 name，再匹配 label）。 */
function matchRule(field: LeadField): string | null {
  const haystacks = [field.name.toLowerCase().replace(/[_-]/g, ' '), field.label.toLowerCase()];
  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (haystacks.some(text => text.includes(keyword))) return rule.target;
    }
  }
  return null;
}

/** Meta 的 field_data → CRM 客户字段。 */
export function mapLeadFields(fields: LeadField[]): MappedLead {
  const out: MappedLead = {
    name: '', companyName: '', country: '', phone: '', whatsapp: '', email: '',
    purchaseType: 'OTHER', productInterest: '', quantity: null, notes: '', extras: [],
  };
  const notes: string[] = [];

  for (const field of fields) {
    const value = field.value.trim();
    if (!value) continue;
    const target = matchRule(field);

    switch (target) {
      case 'name': if (!out.name) out.name = value; else out.extras.push({ label: field.label || field.name, value }); break;
      case 'companyName': if (!out.companyName) out.companyName = value; else out.extras.push({ label: field.label || field.name, value }); break;
      case 'email': if (!out.email) out.email = value; else out.extras.push({ label: field.label || field.name, value }); break;
      case 'whatsapp': if (!out.whatsapp) out.whatsapp = value; else out.extras.push({ label: field.label || field.name, value }); break;
      case 'phone': if (!out.phone) out.phone = value; else out.extras.push({ label: field.label || field.name, value }); break;
      case 'country': if (!out.country) out.country = value; else out.extras.push({ label: field.label || field.name, value }); break;
      case 'productInterest': if (!out.productInterest) out.productInterest = value; else out.extras.push({ label: field.label || field.name, value }); break;
      case 'quantity': if (out.quantity === null) out.quantity = toQuantity(value); else out.extras.push({ label: field.label || field.name, value }); break;
      case 'purchaseType': if (out.purchaseType === 'OTHER') out.purchaseType = toPurchaseType(value); out.extras.push({ label: field.label || field.name, value }); break;
      case 'notes:import': notes.push(`是否从中国进口：${value}`); break;
      case 'notes:concern': notes.push(`采购主要顾虑：${value}`); break;
      default: out.extras.push({ label: field.label || field.name, value });
    }
  }

  // 备注里同时保留可读文本与完整 JSON 原文，便于事后核对
  const parts: string[] = ['来源：Facebook Lead Ads'];
  parts.push(...notes);
  if (out.extras.length) parts.push(...out.extras.map(e => `${e.label}：${e.value}`));
  parts.push('', `表单答案原文：${JSON.stringify(Object.fromEntries(fields.map(f => [f.label || f.name, f.value])))}`);
  out.notes = parts.join('\n');

  // 姓名兜底：Facebook 表单偶尔只给名字
  if (!out.name) out.name = out.companyName || out.email || 'Facebook 线索';
  if (!purchases[out.purchaseType as keyof typeof purchases]) out.purchaseType = 'OTHER';
  return out;
}
