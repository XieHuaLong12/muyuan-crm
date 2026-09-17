import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';

const customerTypes = [
  'IMPORTER',
  'WHOLESALE',
  'DISTRIBUTOR',
  'RETAILER',
  'BRAND',
  'ECOMMERCE',
  'PROJECT',
  'OTHER',
  'UNKNOWN',
] as const;

const intents = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
const suggestedStages = [
  '',
  'NEW',
  'CONTACTED',
  'REPLIED',
  'NEEDS_CONFIRMED',
  'QUOTED',
  'FOLLOW_UP',
  'WON',
  'PAUSED',
  'INVALID',
] as const;

export const deepSeekAnalysisSchema = z.object({
  score: z.coerce.number().int().min(0).max(100),
  intent: z.enum(intents),
  customerType: z.enum(customerTypes),
  products: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  quantity: z.coerce.number().int().min(0).max(10_000_000).nullable().default(null),
  currentNeed: z.string().trim().max(1000).default(''),
  mainObjection: z.string().trim().max(1000).default(''),
  suggestedStage: z.enum(suggestedStages).default(''),
  nextAction: z.string().trim().max(1200).default(''),
  reason: z.string().trim().max(1800).default(''),
  risk: z.string().trim().max(1200).default(''),
  summary: z.string().trim().max(1800).default(''),
  confidence: z.coerce.number().int().min(0).max(100),
});

export type DeepSeekCustomerAnalysis = z.infer<typeof deepSeekAnalysisSchema> & {
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'DORMANT';
};

export function finalizeDeepSeekAnalysis(input: unknown): DeepSeekCustomerAnalysis {
  const parsed = deepSeekAnalysisSchema.parse(input);
  const priority =
    parsed.score >= 80
      ? 'HIGH'
      : parsed.score >= 55
        ? 'MEDIUM'
        : parsed.score >= 30
          ? 'LOW'
          : 'DORMANT';
  return { ...parsed, priority };
}

const clip = (value: string, max = 1600) =>
  value.length <= max ? value : `${value.slice(0, max)}…`;

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function sanitizeLeadValues(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') record[key] = clip(item, 1200);
  }
  for (const key of [
    'phone',
    'whatsapp',
    'email',
    'name',
    'firstName',
    'lastName',
    'leadId',
  ]) delete record[key];
  return record;
}

function deepSeekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, '尚未配置 DEEPSEEK_API_KEY');
  return {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  };
}

async function callDeepSeek(systemPrompt: string, context: unknown, retry = false) {
  const { apiKey, baseUrl, model } = deepSeekConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            (retry
              ? '上一次返回为空或格式错误。请严格只输出合法 json，不要解释。\n'
              : '') + JSON.stringify(context),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 1800,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | null } }>;
  };

  if (!response.ok) {
    throw new HttpError(
      502,
      `DeepSeek API 调用失败：${body.error?.message || `HTTP ${response.status}`}`
    );
  }

  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) {
    if (!retry) return callDeepSeek(systemPrompt, context, true);
    throw new HttpError(502, 'DeepSeek 返回了空内容');
  }

  try {
    return finalizeDeepSeekAnalysis(JSON.parse(content));
  } catch (error) {
    if (!retry) return callDeepSeek(systemPrompt, context, true);
    throw new HttpError(
      502,
      `DeepSeek 返回的客户分析格式不正确：${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

export async function analyzeCustomerWithDeepSeek(customerId: string, user: Actor) {
  const customer = await db.customer.findFirst({
    where: { id: customerId, ...scope(user) },
    include: {
      whatsappMessages: {
        orderBy: { sentAt: 'desc' },
        take: 24,
        select: {
          direction: true,
          messageType: true,
          text: true,
          sentAt: true,
        },
      },
      followUps: {
        orderBy: { followUpAt: 'desc' },
        take: 10,
        select: {
          type: true,
          content: true,
          followUpAt: true,
        },
      },
      submissions: {
        orderBy: { occurredAt: 'desc' },
        take: 4,
        select: {
          occurredAt: true,
          values: true,
        },
      },
      deals: {
        orderBy: { dealDate: 'desc' },
        take: 5,
        select: {
          dealAmount: true,
          currency: true,
          product: true,
          productModel: true,
          quantity: true,
          dealDate: true,
        },
      },
    },
  });

  if (!customer) throw new HttpError(404, '客户不存在或无访问权限');

  const messages = [...customer.whatsappMessages]
    .reverse()
    .map((message) => ({
      direction: message.direction,
      type: message.messageType,
      text: clip(message.text || '', 1800),
      at: message.sentAt.toISOString(),
    }));

  const context = {
    // Deliberately exclude phone, WhatsApp number and email from external AI input.
    customer: {
      companyName: clip(customer.companyName || '', 300),
      country: customer.country,
      city: customer.city,
      source: customer.source,
      sourceDetail: clip(customer.sourceDetail || '', 400),
      language: customer.language,
      purchaseType: customer.purchaseType,
      productInterest: customer.productInterest,
      productModel: customer.productModel,
      quantity: customer.quantity,
      purchaseTimeline: customer.purchaseTimeline,
      shippingCountry: customer.shippingCountry,
      shippingCity: customer.shippingCity,
      stage: customer.stage,
      isQualified: customer.isQualified,
      quotedAmount: Number(customer.quotedAmount),
      currency: customer.currency,
      notes: clip(customer.notes || '', 1800),
    },
    recentWhatsAppMessages: messages,
    recentFollowUps: [...customer.followUps].reverse().map((item) => ({
      type: item.type,
      content: clip(item.content, 1600),
      at: item.followUpAt.toISOString(),
    })),
    recentLeadSubmissions: [...customer.submissions].reverse().map((item) => ({
      at: item.occurredAt.toISOString(),
      values: sanitizeLeadValues(safeJson(item.values)),
    })),
    recentDeals: customer.deals.map((deal) => ({
      amount: Number(deal.dealAmount),
      currency: deal.currency,
      product: deal.product,
      productModel: deal.productModel,
      quantity: deal.quantity,
      at: deal.dealDate.toISOString(),
    })),
  };

  const systemPrompt = `你是家具外贸 CRM 的客户智能分析引擎。你的任务不是替销售做承诺，而是根据事实判断客户的跟进优先级。

必须只输出合法 json。不要输出 Markdown、解释、代码块或额外文字。

分析原则：
1. 只根据输入事实分析，不要猜测客户公司规模、预算、身份或采购数量。
2. WhatsApp 客户主动询问具体型号、数量、FOB/DDP、运费、付款、PI、交期、装柜量等，是较强采购信号。
3. 仅问 price、没有持续互动、长期失联，应降低分数。
4. 已明确采购数量、采购身份、产品型号、时间计划或要求 PI，应提高分数。
5. suggestedStage 只是建议，系统不会自动修改 CRM 阶段。
6. summary、currentNeed、mainObjection、nextAction、reason、risk 使用简洁中文。
7. products 只列出对话或资料中明确出现的产品/型号。
8. quantity 如果没有明确数字必须为 null。
9. confidence 表示你对本次判断的把握程度，而不是成交概率。

score：0-100，表示销售跟进价值与当前采购意向的综合优先级。
intent：HIGH / MEDIUM / LOW / UNKNOWN。
customerType：IMPORTER / WHOLESALE / DISTRIBUTOR / RETAILER / BRAND / ECOMMERCE / PROJECT / OTHER / UNKNOWN。
suggestedStage 只能是 NEW / CONTACTED / REPLIED / NEEDS_CONFIRMED / QUOTED / FOLLOW_UP / WON / PAUSED / INVALID 或空字符串。

JSON 示例：
{
  "score": 88,
  "intent": "HIGH",
  "customerType": "IMPORTER",
  "products": ["Y-601"],
  "quantity": 30,
  "currentNeed": "需要30件Y-601的FOB报价",
  "mainObjection": "尚未确认目的港和运费",
  "suggestedStage": "QUOTED",
  "nextAction": "询问目的港，并给出30件的FOB与装柜建议",
  "reason": "客户明确型号、数量并主动询价，属于有效采购信号",
  "risk": "如果48小时内没有继续沟通，可能进入比价阶段",
  "summary": "沙特客户对Y-601有明确采购意向，当前重点是报价与物流方案。",
  "confidence": 92
}`;

  const analysis = await callDeepSeek(systemPrompt, context);
  const now = new Date();
  const lastMessageAt = customer.whatsappMessages[0]?.sentAt ?? null;

  await db.$transaction([
    db.customerIntelligence.upsert({
      where: { customerId },
      create: {
        customerId,
        score: analysis.score,
        priority: analysis.priority,
        intent: analysis.intent,
        customerType: analysis.customerType,
        productsJson: JSON.stringify(analysis.products),
        quantity: analysis.quantity,
        currentNeed: analysis.currentNeed,
        mainObjection: analysis.mainObjection,
        suggestedStage: analysis.suggestedStage,
        nextAction: analysis.nextAction,
        reason: analysis.reason,
        risk: analysis.risk,
        confidence: analysis.confidence,
        lastMessageAt,
        analyzedAt: now,
      },
      update: {
        score: analysis.score,
        priority: analysis.priority,
        intent: analysis.intent,
        customerType: analysis.customerType,
        productsJson: JSON.stringify(analysis.products),
        quantity: analysis.quantity,
        currentNeed: analysis.currentNeed,
        mainObjection: analysis.mainObjection,
        suggestedStage: analysis.suggestedStage,
        nextAction: analysis.nextAction,
        reason: analysis.reason,
        risk: analysis.risk,
        confidence: analysis.confidence,
        lastMessageAt,
        analyzedAt: now,
      },
    }),
    db.customer.update({
      where: { id: customerId },
      data: {
        aiScore: analysis.score,
        aiPriority: analysis.priority,
        aiIntent: analysis.intent,
        aiSummary: analysis.summary,
        aiNextAction: analysis.nextAction,
        aiReason: analysis.reason,
        aiRisk: analysis.risk,
        aiLastAnalyzedAt: now,
      },
    }),
  ]);

  return {
    customerId,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    analysis,
    analyzedAt: now,
  };
}
