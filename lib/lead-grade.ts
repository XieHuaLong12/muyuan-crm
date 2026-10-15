/**
 * Ad-form lead grades. A form arrives, gets a grade within seconds, and the grade decides how loudly the CRM and
 * the phones announce it. DeepSeek grades from the whole form; these rules are the fallback (no key, AI failure,
 * smart import, older leads) and the shared definition of what each grade means.
 */
export const LEAD_GRADES = {
  A: { label: 'A 优质', ring: 'loop' },
  B: { label: 'B 良好', ring: 'loop' },
  C: { label: 'C 一般', ring: 'once' },
  D: { label: 'D 无效', ring: 'none' },
} as const;
export type LeadGrade = keyof typeof LEAD_GRADES;
export type RingMode = 'loop' | 'once' | 'none';
export const isLeadGrade = (value: string): value is LeadGrade => value in LEAD_GRADES;
/** Ungraded leads (grading still running) ring like a good lead: better one ring too many than a missed buyer. */
export const ringFor = (grade: string): RingMode => isLeadGrade(grade) ? LEAD_GRADES[grade].ring : 'loop';

/** Minimum order per model: 10 online, 20 when negotiated offline (ProductMoq). */
export const GRADE_A_MIN_QUANTITY = 20;
export const GRADE_B_MIN_QUANTITY = 10;
const BUSINESS_BUYERS = new Set(['WHOLESALE', 'IMPORTER', 'DISTRIBUTOR', 'RETAILER', 'BRAND', 'ECOMMERCE']);
const BUYER_LABELS: Record<string, string> = { WHOLESALE: '批发商', IMPORTER: '进口商', DISTRIBUTOR: '经销商', RETAILER: '家具零售店', BRAND: '品牌客户', ECOMMERCE: '电商客户' };

export type FormAnswer = { question: string; answer: string };
export type GradeInput = {
  answers: FormAnswer[];
  purchaseType: string;
  quantity: number | null;
  productInterest: string;
  country: string;
  hasPhone: boolean;
  hasEmail: boolean;
  testLead: boolean;
};
export type GradeResult = { grade: LeadGrade; reason: string; source: 'AI' | 'RULE' };

// Contact details stay out of the grading input (and out of the AI prompt); only whether they exist matters.
const CONTACT_QUESTION = /e-?mail|phone|mobile|whats ?app|telephone|\btel\b|full ?name|first ?name|last ?name|^name$|your name|姓名|邮箱|电话|手机/i;

/**
 * The questions and answers of a stored submission: Meta's Graph lead (field_data) or a smart-import CSV row.
 * Contact fields are left out.
 */
export function formAnswers(raw: string): FormAnswer[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const pairs: [string, string][] = [];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { field_data?: unknown }).field_data)) {
    for (const field of (parsed as { field_data: { name?: unknown; values?: unknown }[] }).field_data) {
      const values = Array.isArray(field.values) ? field.values.filter((v): v is string => typeof v === 'string') : [];
      if (typeof field.name === 'string' && values.length) pairs.push([field.name, values.join(', ')]);
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [question, answer] of Object.entries(parsed)) if (typeof answer === 'string') pairs.push([question, answer]);
  }
  return pairs
    .map(([question, answer]) => ({ question: question.replace(/[_]+/g, ' ').trim().slice(0, 200), answer: answer.trim().slice(0, 500) }))
    .filter(pair => pair.answer && !CONTACT_QUESTION.test(pair.question))
    .slice(0, 40);
}

/** "Do you currently import furniture from China?" in the languages the forms run in. */
export function importsFromChina(answers: FormAnswer[]): boolean | null {
  const question = answers.find(a => /import.*china|china.*import|importez|importa|从中国|進口|进口/i.test(a.question));
  if (!question) return null;
  // Meta returns choice keys such as "yes,_regularly" or "not_yet".
  const answer = question.answer.toLowerCase().replace(/_/g, ' ').trim();
  if (/^(no|non|não|nao|nein|nunca|never|not yet|pas encore)(?![a-z])|^(لا|否|没)/.test(answer)) return false;
  if (/^(yes|oui|si|sí|sim|ja|already|déjà|deja)(?![a-z])|^(نعم|是|有|已)/.test(answer)) return true;
  return null;
}

/** The fallback grade: buyer type, import experience, quantity per model and a reachable contact. */
export function ruleGrade(input: GradeInput): GradeResult {
  const result = (grade: LeadGrade, reasons: string[]): GradeResult => ({ grade, reason: reasons.join('；').slice(0, 500), source: 'RULE' });
  if (input.testLead) return result('D', ['Meta 测试线索']);
  if (!input.hasPhone && !input.hasEmail) return result('D', ['没有可联系的号码或邮箱']);
  const business = BUSINESS_BUYERS.has(input.purchaseType);
  const imports = importsFromChina(input.answers);
  const quantity = input.quantity;
  const facts = [
    business ? BUYER_LABELS[input.purchaseType] : '买家类型不明',
    quantity === null ? '未填写数量' : `每款 ${quantity} 件`,
    imports === true ? '已从中国进口' : imports === false ? '未从中国进口过' : '',
    input.country,
  ].filter(Boolean);
  if (business && imports === true && quantity !== null && quantity >= GRADE_A_MIN_QUANTITY) return result('A', facts);
  if ((business && (imports === true || (quantity !== null && quantity >= GRADE_B_MIN_QUANTITY))) || (quantity !== null && quantity >= GRADE_A_MIN_QUANTITY)) return result('B', facts);
  return result('C', facts);
}
