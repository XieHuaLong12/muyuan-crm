import { z } from 'zod';
import { db } from '@/lib/db';
import { canonicalEmail, canonicalPhone } from '@/lib/contact-identity';
import { formAnswers, ruleGrade, GRADE_A_MIN_QUANTITY, GRADE_B_MIN_QUANTITY, type GradeInput, type GradeResult } from '@/lib/lead-grade';
import { purchases } from '@/lib/constants';
import { callDeepSeek, deepSeekConfigured } from './deepseek-customer-service';

const GRADE_PROMPT = `你是一家中国家具工厂外贸团队的线索评级助手。我们做 B2B 出口（沙发、压缩卷包沙发等），客户是海外批发商、进口商、经销商、家具店、品牌和电商；每款起订量线上 ${GRADE_B_MIN_QUANTITY} 件、线下 ${GRADE_A_MIN_QUANTITY} 件。个人零售买家不是我们的客户。
根据 Meta 广告表单的答案给这条线索评级：
A 优质：明确的企业买家，采购量达到起订量（每款 ≥ ${GRADE_A_MIN_QUANTITY} 件或整柜），并且已有从中国进口的经验或明确的采购计划；
B 良好：企业买家但信息不全（数量偏小或未填、没有进口经验），或数量可观但身份不明；
C 一般：身份不明、像个人买家、需求模糊或只是随便问问；
D 无效：测试数据、明显乱填、与家具无关。
只根据给出的答案判断，不要编造。答案可能是法语、西班牙语、阿拉伯语等，也可能是 Meta 的选项代码（如 yes,_regularly）。
只输出 json：{"grade":"A|B|C|D","reasons":["最多 3 条中文要点，每条不超过 20 个字，例如：批发商、每款 50 件、已从中国进口"]}`;

const aiGrade = z.object({ grade: z.enum(['A', 'B', 'C', 'D']), reasons: z.array(z.string().trim().min(1).max(60)).min(1).max(4) });

/** What the grade is based on: the latest form answers (without contact details) and the mapped profile. */
async function gradeInput(customerId: string): Promise<GradeInput | null> {
  const c = await db.customer.findUniqueOrThrow({ where: { id: customerId }, select: {
    phone: true, whatsapp: true, waId: true, countryCode: true, email: true, purchaseType: true, quantity: true, productInterest: true, country: true,
    submissions: { orderBy: { ordinal: 'desc' }, take: 1, select: { raw: true } },
  } });
  // Only ad-form leads are graded; customers who wrote on WhatsApp are judged from the conversation instead.
  if (!c.submissions.length) return null;
  const raw = c.submissions[0].raw;
  return {
    answers: formAnswers(raw),
    purchaseType: c.purchaseType,
    quantity: c.quantity,
    productInterest: c.productInterest,
    country: c.country,
    hasPhone: !!(canonicalPhone(c.whatsapp, undefined, true) || canonicalPhone(c.waId, undefined, true) || canonicalPhone(c.phone, c.countryCode) || canonicalPhone(c.phone, undefined, true)),
    hasEmail: !!canonicalEmail(c.email),
    testLead: /test lead|dummy data/i.test(raw),
  };
}

/**
 * Grades a lead and saves the grade. DeepSeek reads the whole form when configured (it understands free text such
 * as "two containers" or "I own three shops"); without a key, on failure or after `timeoutMs` the rules decide.
 * A lead nobody can contact, or Meta's test lead, is D without asking the AI.
 */
export async function gradeLead(customerId: string, options: { ai?: boolean; timeoutMs?: number } = {}): Promise<GradeResult | null> {
  const input = await gradeInput(customerId);
  if (!input) return null;
  let result = ruleGrade(input);
  if ((options.ai ?? true) && deepSeekConfigured() && result.grade !== 'D') {
    try {
      const context = { ...input, purchaseType: purchases[input.purchaseType as keyof typeof purchases] ?? '未知', quantityPerModel: input.quantity, quantity: undefined };
      const ai = await callDeepSeek(GRADE_PROMPT, context, value => aiGrade.parse(value), false, options.timeoutMs ?? 12_000);
      result = { grade: ai.grade, reason: ai.reasons.join('；').slice(0, 500), source: 'AI' };
    } catch (error) {
      console.warn('[lead-grade] AI grading failed, using rules', { customerId, error: error instanceof Error ? error.message : 'unknown' });
    }
  }
  const current = await db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { updatedAt: true } });
  // A grade is not an edit: keep updatedAt, so open edit forms and "recently updated" orderings are unaffected.
  await db.customer.update({ where: { id: customerId }, data: {
    leadGrade: result.grade, leadGradeReason: result.reason, leadGradeSource: result.source, leadGradedAt: new Date(), updatedAt: current.updatedAt,
  } });
  return result;
}

/** Rule grades for leads that have none yet: smart imports, customers from before grading existed. Bounded per call. */
export async function gradeUngradedLeads(where: { id?: { in: string[] } } = {}, limit = 50) {
  const rows = await db.customer.findMany({ where: { ...where, deletedAt: null, leadGrade: '', submissions: { some: {} } }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: limit });
  for (const row of rows) await gradeLead(row.id, { ai: false });
  return { graded: rows.length };
}
