import { z } from 'zod';
import { Actor, HttpError } from '@/lib/auth';

const customerTypes = [
  'IMPORTER',
  'WHOLESALE',
  'DISTRIBUTOR',
  'RETAILER',
  'BRAND',
  'ECOMMERCE',
  'PROJECT',
  'PERSONAL',
  'DROPSHIPPING',
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
  'CATALOG_SENT',
  'PRODUCT_CONFIRMED',
  'QUOTED',
  'FOLLOW_UP',
  'WON',
  'PAUSED',
  'INVALID',
  'ORDER',
  'LOST',
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

function deepSeekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, '尚未配置 DEEPSEEK_API_KEY');
  return {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  };
}

export const deepSeekConfigured = () => !!process.env.DEEPSEEK_API_KEY?.trim();

export async function callDeepSeek<T>(systemPrompt: string, context: unknown, parse: (input: unknown) => T, retry = false, timeoutMs = 45_000): Promise<T> {
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
    signal: AbortSignal.timeout(timeoutMs),
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
    if (!retry) return callDeepSeek(systemPrompt, context, parse, true, timeoutMs);
    throw new HttpError(502, 'DeepSeek 返回了空内容');
  }

  try {
    return parse(JSON.parse(content));
  } catch (error) {
    if (!retry) return callDeepSeek(systemPrompt, context, parse, true, timeoutMs);
    throw new HttpError(
      502,
      `DeepSeek 返回的客户分析格式不正确：${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

export async function analyzeCustomerWithDeepSeek(customerId: string, user: Actor) {
  return (await import('./customer-intelligence-service')).analyzeIncrementalCustomer(customerId,user);
}
