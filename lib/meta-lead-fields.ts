import { purchases } from '@/lib/constants';
import { BUYER_QUESTION, QUANTITY_QUESTION, TIMELINE_QUESTION, buyerTypeOf, plainText, quantityOf } from '@/lib/lead-answers';

/**
 * Facebook 表单问题 → CRM 字段映射。
 *
 * Meta 的 field_data 用表单内部字段名（name）返回，不同表单的命名可能不同，
 * 因此这里按**关键词**匹配 name 与问题文本（label），而不是写死某个字段名。
 * 匹配不到的内容一律进 notes，并保留完整 JSON 原文。
 */

/**
 * Facebook 表单问题里的关键词 → CRM 目标字段。顺序即优先级。
 * 客户类型、数量、下单时间按问题的意思识别（lib/lead-answers.ts），不同表单的不同问法都能认出；客户类型排在
 * 公司名前面，「Which best describes your company?」不会被当成公司名。
 */
const RULES: { target: string; keywords?: string[]; pattern?: RegExp }[] = [
  { target: 'purchaseType', pattern: BUYER_QUESTION },
  { target: 'purchaseTimeline', pattern: TIMELINE_QUESTION },
  { target: 'companyName', keywords: ['company', 'company name', 'business name', '公司'] },
  { target: 'name', keywords: ['full name', 'full_name', 'your name', 'name', '姓名'] },
  { target: 'email', keywords: ['email', 'e-mail', '邮箱'] },
  { target: 'whatsapp', keywords: ['whatsapp', 'whats app', '沃次'] },
  { target: 'phone', keywords: ['phone', 'mobile', 'telephone', '电话'] },
  { target: 'notes:market', keywords: ['market or country','which market','market','市场'] },
  { target: 'country', keywords: ['country','国家'] },
  { target: 'quantity', pattern: QUANTITY_QUESTION },
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
  purchaseTimeline: string;
  notes: string;
  /** 未识别的问题，原样保留在备注里 */
  extras: { label: string; value: string }[];
};

/** 客户类型答案 → CRM 采购类型；设计师 / 工程客户和认不出的都记为 OTHER，不猜测（原答案保留在备注里）。 */
function toPurchaseType(value: string): string {
  const type = buyerTypeOf(value);
  return type && type !== 'PROJECT' ? type : 'OTHER';
}

/** 只记明确的件数（「50」「50 pcs」）；区间、「200+」、整柜等不猜测，原答案保留在备注里，评级时按下限算。 */
function toQuantity(value: string): number | null {
  const q = quantityOf(value);
  return q?.exact && q.min !== null && q.min <= 2147483647 ? q.min : null;
}

/** 判断一条 field_data 命中了哪条规则（先匹配 name，再匹配 label）。 */
function matchRule(field: LeadField): string | null {
  const haystacks = [field.name.toLowerCase().replace(/[_-]/g, ' '), field.label.toLowerCase()];
  for (const rule of RULES) {
    if (rule.pattern && haystacks.some(text => rule.pattern!.test(plainText(text)))) return rule.target;
    for (const keyword of rule.keywords ?? []) {
      if (haystacks.some(text => text.includes(keyword))) return rule.target;
    }
  }
  return null;
}

/** Meta 的 field_data → CRM 客户字段。 */
export type LeadMeta = { leadgenId: string; formId: string };

export function mapLeadFields(fields: LeadField[], meta: LeadMeta = { leadgenId: '', formId: '' }): MappedLead {
  const out: MappedLead = {
    name: '', companyName: '', country: '', phone: '', whatsapp: '', email: '',
    purchaseType: 'OTHER', productInterest: '', quantity: null, purchaseTimeline: '', notes: '', extras: [],
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
      // 数量、下单时间的原答案也留在备注里。
      case 'quantity': if (out.quantity === null) out.quantity = toQuantity(value); out.extras.push({ label: field.label || field.name, value }); break;
      case 'purchaseTimeline': if (!out.purchaseTimeline) out.purchaseTimeline = plainText(value).slice(0, 100); out.extras.push({ label: field.label || field.name, value }); break;
      case 'purchaseType': if (out.purchaseType === 'OTHER') out.purchaseType = toPurchaseType(value); out.extras.push({ label: field.label || field.name, value }); break;
      case 'notes:market': notes.push(`销售市场（不推断客户所在国）：${value}`); break;
      case 'notes:import': notes.push(`是否从中国进口：${value}`); break;
      case 'notes:concern': notes.push(`采购主要顾虑：${value}`); break;
      default: out.extras.push({ label: field.label || field.name, value });
    }
  }

  // 备注 = 可读摘要 + 规定格式的 JSON 原文，便于事后核对广告来源与表单答案
  const parts: string[] = ['来源：Facebook Lead Ads'];
  parts.push(...notes);
  if (out.extras.length) parts.push(...out.extras.map(e => `${e.label}：${e.value}`));
  const archive = {
    facebookLeadId: meta.leadgenId,
    formId: meta.formId,
    answers: Object.fromEntries(fields.map(f => [f.label || f.name, f.value])),
  };
  parts.push('', 'FACEBOOK_LEAD_JSON:', JSON.stringify(archive));
  out.notes = parts.join('\n');

  // 姓名兜底：Facebook 表单偶尔只给名字
  if (!out.name) out.name = out.companyName || out.email || 'Facebook 线索';
  if (!purchases[out.purchaseType as keyof typeof purchases]) out.purchaseType = 'OTHER';
  return out;
}
