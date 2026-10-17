import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { gupshupSource } from '@/lib/gupshup';
import { canonicalPhone } from '@/lib/contact-identity';
import { normalizeWhatsApp } from '@/lib/whatsapp';
import { accessible } from './customer-service';
import { gupshupReady, recipientNumber, recordAcceptedOutbound } from './whatsapp-message-service';

/**
 * Outside the 24-hour window WhatsApp only delivers templates Meta approved. The approved list is read live from
 * Gupshup (never invented locally); a template is always previewed and sent by a person, never automatically.
 */
export type ApprovedTemplate = { id: string; name: string; language: string; category: string; body: string; variables: number };

const providerTemplate = z.object({ id: z.string().min(1).max(100), elementName: z.string().max(200).default(''), languageCode: z.string().max(20).default(''),
  category: z.string().max(40).default(''), status: z.string().max(40).default(''), templateType: z.string().max(40).default('TEXT'), data: z.string().max(4096).default('') }).passthrough();
const CACHE_MS = 5 * 60_000;
let cache: { at: number; key: string; templates: ApprovedTemplate[] } | null = null;

export const templatesConfigured = () => gupshupReady() && !!process.env.GUPSHUP_APP_ID?.trim();
/** Highest {{n}} in the body: Gupshup expects one parameter per numbered placeholder, in order. */
export const templateVariables = (body: string) => Math.max(0, ...[...body.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)].map(match => Number(match[1])));
export const renderTemplate = (body: string, params: string[]) => body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (whole, n) => params[Number(n) - 1] ?? whole);

export async function approvedTemplates(force = false): Promise<ApprovedTemplate[]> {
  if (!templatesConfigured()) return [];
  const appId = process.env.GUPSHUP_APP_ID!.trim(), apiKey = process.env.GUPSHUP_API_KEY!.trim(), key = `${appId}:${apiKey.length}`;
  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.templates;
  let body: { status?: string; templates?: unknown[] };
  try {
    const response = await fetch(`https://api.gupshup.io/wa/app/${encodeURIComponent(appId)}/template`, { headers: { apikey: apiKey }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    body = await response.json().catch(() => ({}));
    if (!response.ok || body.status !== 'success' || !Array.isArray(body.templates)) throw new Error('TEMPLATE_LIST_REJECTED');
  } catch {
    throw new HttpError(502, '暂时无法从 Gupshup 读取已审核模板，请稍后重试');
  }
  const templates = body.templates!.flatMap(item => {
    const parsed = providerTemplate.safeParse(item);
    // Only plain-text templates can be filled in here; media headers need a file the template was approved with.
    if (!parsed.success || parsed.data.status.toUpperCase() !== 'APPROVED' || parsed.data.templateType.toUpperCase() !== 'TEXT' || !parsed.data.data) return [];
    const t = parsed.data;
    return [{ id: t.id, name: t.elementName || t.id, language: t.languageCode, category: t.category, body: t.data, variables: templateVariables(t.data) }];
  });
  cache = { at: Date.now(), key, templates };
  return templates;
}

/**
 * First-touch templates by lead source, best first: the v2 greeting, then the first version already approved in
 * Gupshup. Names are matched with any language suffix (lvanju_hi_fb_en, lvanju_hi_fb_fr…).
 */
export const FIRST_TOUCH_TEMPLATES: Record<string, string[]> = {
  FACEBOOK: ['lvanju_hi_fb', 'lvanju_first_fb'],
  INSTAGRAM: ['lvanju_hi_ig', 'lvanju_first_ig'],
};
/** Words in the ad name or form answers that name a product line; electric is checked before mattress. */
const PRODUCT_LINE_WORDS: [string, RegExp][] = [
  ['smart electric mattresses', /electric|smart[\s-]*(bed|mattress)|adjustable[\s-]*(bed|base|mattress)|massage|电动|智能床/i],
  ['vacuum-packed mattresses', /mattress|matelas|colch[oó]n|床垫|مرتبة|فرشة/i],
  ['compressed sofas', /sofa|couch|canap[eé]|sof[aá]|沙发|كنب/i],
];

/**
 * What a template variable stands for, read from the words around it ("___" is the variable, other variables "…").
 * Checked in order; a variable none of them describes is left for the salesperson.
 */
export type VariableSource = 'firstName' | 'owner' | 'quoteNo' | 'orderNo' | 'eta' | 'productLine';
const VARIABLE_PATTERNS: [VariableSource, RegExp][] = [
  ['owner', /\b(it'?s|it’s|this is|i am|i'?m|i’m|c'?est|c’est|je suis|soy)\s+___|___\s+(here|ici|aquí|from (lvanju|our)|de lvanju)/i],
  ['firstName', /(^|[\s,.!?])(hi|hello|hey|dear|bonjour|salut|hola|ciao|ol[aá]|مرحبا)\s*,?\s*___/i],
  ['quoteNo', /\b(quotation|quote|devis|cotizaci[oó]n|proforma|\bpi)\s*(no\.?|number|#)?\s*___/i],
  ['orderNo', /\b(order|commande|pedido|po)\s*(no\.?|number|#)?\s*___/i],
  ['eta', /(delivery date|arrival date|\beta|arrive[sd]?|be delivered|livraison|entrega)\s+(date\s+)?(is|on|by|around|:|le|el)?\s*___/i],
  ['productLine', /((\bads?|\badvert\S*|\bpublicit\S*|\banuncio)\s+(\w+\s+)?(for|about|on|pour|sur|de|para)|(quotation|quote|catalog(ue)?|price sheet|prices|samples?|devis)\s+(…\s+)?(for|of|on|pour|de)|interested in|looking for)\s+___/i],
];
const SOURCE_LABELS: Record<VariableSource, string> = { firstName: '客户名', owner: '负责销售', quoteNo: '报价单号', orderNo: '订单号', eta: '预计送达日期', productLine: '产品线' };

/** A few whole words either side of the variable ("___"), shown so the salesperson sees where it goes. */
function contextAround(text: string, index: number) {
  let start = Math.max(0, index - 20), end = Math.min(text.length, index + 3 + 16);
  if (start > 0 && !/\s/.test(text[start - 1])) start = text.indexOf(' ', start) + 1 || index;
  if (end < text.length && !/\s/.test(text[end])) end = Math.max(index + 3, text.lastIndexOf(' ', end));
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** For each variable {{1}}…{{n}}: what it stands for (null when the words around it do not say) and that context. */
export function variableSources(body: string, variables: number) {
  return Array.from({ length: variables }, (_, i) => {
    const marker = new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`);
    const at = body.search(marker);
    if (at < 0) return { source: null, context: '' };
    const blank = body.replace(marker, '___').replace(/\{\{\s*\d{1,2}\s*\}\}/g, '…');
    const index = blank.indexOf('___');
    const window = blank.slice(Math.max(0, index - 48), index + 33).replace(/\s+/g, ' ');
    const source = VARIABLE_PATTERNS.find(([, pattern]) => pattern.test(window))?.[0] ?? null;
    return { source, context: contextAround(blank, index) };
  });
}

/** "MUHAMMAD ANAS" → "Muhammad"; '' when the name is a number or empty, so the salesperson types it. */
export function firstNameOf(name: string) {
  const word = name.trim().split(/\s+/)[0] ?? '';
  if (!/\p{L}/u.test(word)) return '';
  const cased = word.toLowerCase() !== word.toUpperCase();
  return cased && (word === word.toUpperCase() || word === word.toLowerCase()) ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

/** The product line an ad name or form answer names, in the English the templates use; '' when it names none. */
export function productLineOf(...texts: string[]) {
  const text = texts.join(' ').replace(/_+/g, ' ');
  return PRODUCT_LINE_WORDS.find(([, words]) => words.test(text))?.[0] ?? '';
}

/** What the customer record says, for filling variables. Quotation and order are the latest sent / not cancelled. */
export type TemplateFacts = { name: string; owner: string; productLine: string; quote: { number: string; sentAt: string } | null;
  order: { number: string; eta: string } | null };
export type VariableFill = { source: VariableSource | null; label: string; context: string; value: string; note: string };

/**
 * Each variable of a template filled from the customer record, with where the value came from or why it is empty.
 * Product lines are English names, so other-language templates leave that variable to the salesperson.
 */
export function fillVariables(template: ApprovedTemplate, facts: TemplateFacts): VariableFill[] {
  const english = !template.language || template.language.toLowerCase().startsWith('en');
  return variableSources(template.body, template.variables).map(({ source, context }) => {
    if (!source) return { source, label: '未识别', context, value: '', note: '模板这个位置看不出要填什么，请手动填写。' };
    const fill = (value: string, from: string, missing: string) => ({ source, label: SOURCE_LABELS[source], context, value, note: value ? from : missing });
    switch (source) {
      case 'firstName': return fill(firstNameOf(facts.name), `取自客户姓名「${facts.name}」的第一个词`, '客户姓名里没有可用的名字，请手动填写。');
      case 'owner': return fill(facts.owner, '取自负责人', '这位客户没有负责人，请手动填写。');
      case 'productLine': return english ? fill(facts.productLine, '按广告名和表单答案判断', '看不出产品线，请在下面选一个。')
        : fill('', '', '产品线名称是英文，这个模板请手动填写。');
      case 'quoteNo': return fill(facts.quote?.number ?? '', `取自最近一份已发出的报价单（${facts.quote?.sentAt ?? ''}）`, '这位客户还没有发出过报价单，请手动填写。');
      case 'orderNo': return fill(facts.order?.number ?? '', '取自最近的订单', '这位客户还没有订单，请手动填写，或先在客户档案里建订单。');
      case 'eta': return fill(facts.order?.eta ?? '', `取自订单 ${facts.order?.number ?? ''} 的预计送达日期`,
        facts.order ? `订单 ${facts.order.number} 还没有填预计送达日期，请手动填写。` : '这位客户还没有订单，请手动填写。');
    }
  });
}

/** The greeting a never-contacted Facebook or Instagram lead should get first; the customer's language goes first. */
export function firstTouchTemplate(customer: { source: string; language: string }, templates: ApprovedTemplate[]) {
  const prefixes = FIRST_TOUCH_TEMPLATES[customer.source];
  if (!prefixes) return null;
  const language = /^[a-z]{2}/i.test(customer.language.trim()) ? customer.language.trim().slice(0, 2).toLowerCase() : 'en';
  const languageRank = (template: ApprovedTemplate) => template.language.toLowerCase().startsWith(language) ? 0 : template.language.toLowerCase().startsWith('en') ? 1 : 2;
  for (const prefix of prefixes) {
    const match = templates.filter(t => t.name === prefix || t.name.startsWith(`${prefix}_`)).sort((a, b) => languageRank(a) - languageRank(b))[0];
    if (match) return match;
  }
  return null;
}

export async function listTemplates(user: Actor, input: unknown) {
  const { customerId, refresh } = z.object({ customerId: z.string().trim().min(1).max(191), refresh: z.enum(['1']).optional() }).parse(input);
  await accessible(customerId, user);
  if (!templatesConfigured()) return { status: 'NOT_CONNECTED' as const, templates: [], suggestion: null, fills: {} as Record<string, VariableFill[]> };
  const [templates, customer, setting] = await Promise.all([approvedTemplates(!!refresh), db.customer.findUniqueOrThrow({ where: { id: customerId },
    select: { name: true, source: true, sourceDetail: true, productInterest: true, productModel: true, language: true, firstContactAt: true, lastOutboundAt: true,
      owner: { select: { name: true } },
      quotations: { where: { sentAt: { not: null } }, orderBy: { sentAt: 'desc' }, take: 1, select: { quoteNumber: true, sentAt: true } },
      orders: { where: { status: { not: 'CANCELLED' } }, orderBy: { orderDate: 'desc' }, take: 1, select: { orderNo: true, estimatedDelivery: true } } } }),
    db.setting.findUnique({ where: { id: 'system' }, select: { timezone: true } })]);
  // Dates go to the customer, so they are written in English ("November 20, 2026") in the business time zone.
  const english = (date: Date) => new Intl.DateTimeFormat('en-US', { timeZone: setting?.timezone ?? 'Asia/Shanghai', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
  const quote = customer.quotations[0], order = customer.orders[0];
  const facts: TemplateFacts = { name: customer.name, owner: customer.owner.name.trim(),
    productLine: productLineOf(customer.sourceDetail, customer.productInterest, customer.productModel),
    quote: quote ? { number: quote.quoteNumber, sentAt: new Intl.DateTimeFormat('zh-CN', { timeZone: setting?.timezone ?? 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(quote.sentAt!) + ' 发出' } : null,
    order: order ? { number: order.orderNo, eta: order.estimatedDelivery ? english(order.estimatedDelivery) : '' } : null };
  const fills = Object.fromEntries(templates.map(t => [t.id, fillVariables(t, facts)]));
  // Only a customer nobody has written to yet gets a greeting picked for them.
  const greeting = !customer.firstContactAt && !customer.lastOutboundAt ? firstTouchTemplate(customer, templates) : null;
  return { status: 'CONNECTED' as const, templates, suggestion: greeting ? { templateId: greeting.id } : null, fills };
}

export const templateSendSchema = z.object({ customerId: z.string().trim().min(1).max(191), templateId: z.string().trim().min(1).max(100),
  params: z.array(z.string().trim().min(1, '请填写模板中的每个变量').max(1000)).max(20).default([]), requestId: z.string().uuid() });

export async function sendTemplateMessage(input: unknown, user: Actor) {
  const v = templateSendSchema.parse(input);
  const customer = await accessible(v.customerId, user);
  if (!templatesConfigured()) throw new HttpError(503, '尚未配置 Gupshup 模板发送（需要 GUPSHUP_APP_ID 等配置）');
  const template = (await approvedTemplates()).find(item => item.id === v.templateId);
  if (!template) throw new HttpError(404, '模板不存在或尚未审核通过');
  if (v.params.length !== template.variables) throw new HttpError(400, `这个模板需要填写 ${template.variables} 个变量`);
  const content = renderTemplate(template.body, v.params);
  const existing = await db.whatsAppMessage.findUnique({ where: { requestId: v.requestId } });
  if (existing) {
    if (existing.customerId !== v.customerId || existing.content !== content) throw new HttpError(409, '发送请求编号已使用');
    return { message: existing };
  }
  const provider = 'gupshup', providerAccountId = gupshupSource()!, source = normalizeWhatsApp(providerAccountId);
  const destination = await recipientNumber(customer, provider, providerAccountId);
  if (customer.whatsappOptInStatus === 'OPTED_OUT') throw new HttpError(409, '客户已明确退订，请先人工核对后续沟通许可');

  let message;
  try {
    message = await db.whatsAppMessage.create({ data: { customerId: v.customerId, requestId: v.requestId, waId: destination, source: provider, providerAccountId,
      sourcePhone: canonicalPhone(source, undefined, true), destinationPhone: canonicalPhone(destination, undefined, true), direction: 'OUTBOUND', sender: source, content,
      messageType: 'TEMPLATE', status: 'PENDING', sentAt: new Date(), raw: JSON.stringify({ template: { id: template.id, name: template.name, language: template.language } }) } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await db.whatsAppMessage.findUniqueOrThrow({ where: { requestId: v.requestId } });
      if (duplicate.customerId !== v.customerId || duplicate.content !== content) throw new HttpError(409, '发送请求编号已使用');
      return { message: duplicate };
    }
    throw error;
  }

  let providerMessageId = '';
  try {
    const response = await fetch('https://api.gupshup.io/wa/api/v1/template/msg', { method: 'POST',
      headers: { apikey: process.env.GUPSHUP_API_KEY!.trim(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ channel: 'whatsapp', source, destination, 'src.name': process.env.GUPSHUP_APP_NAME!.trim(),
        template: JSON.stringify({ id: template.id, params: v.params }) }),
      signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => ({})) as { status?: string; messageId?: string };
    if (!response.ok || body.status !== 'submitted' || typeof body.messageId !== 'string' || !body.messageId) {
      return { message: await db.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'FAILED' } }),
        error: 'Gupshup 未接受此模板消息，请检查模板状态与变量。' };
    }
    providerMessageId = body.messageId;
  } catch {
    // A timeout cannot prove rejection: keep a durable record and never auto-resend.
    return { message: await db.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'UNKNOWN' } }),
      error: '发送结果未知，请核对 WhatsApp 后再操作；系统不会自动重复发送。' };
  }
  return { message: await recordAcceptedOutbound({ messageId: message.id, customerId: v.customerId, provider, providerAccountId, destination, providerMessageId, user }) };
}
