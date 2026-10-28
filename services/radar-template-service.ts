import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { TEMPLATE_CODE, checkTemplate, type MailLanguage } from '@/lib/radar-mail';

type Client = Prisma.TransactionClient | typeof db;

/**
 * 开发信模板库 (docs/CUSTOMER_RADAR_COLD_EMAIL.md §4.5). Codes are language-step-version (FR-1-A). A template that went
 * out once is locked: its words are what the reply rate measured, so changing them means a new version.
 */

const status = z.enum(['TESTING', 'WINNER', 'RETIRED']);
const variant = z.enum(['STANDARD', 'FAIR']);
const templateInput = z.object({
  code: z.string().trim().toUpperCase().regex(TEMPLATE_CODE, '模板编号格式为 语言-封次-版本，例如 FR-1-A、EN-2-B'),
  variant: variant.default('STANDARD'),
  subject: z.string().trim().max(200, '主题最多 200 字').default(''),
  body: z.string().trim().min(1, '请填写正文').max(5000, '正文最多 5000 字'),
  status: status.default('TESTING'),
  versionNote: z.string().trim().max(300, '版本说明最多 300 字').default(''),
});
const templatePatch = z.object({
  subject: z.string().trim().max(200, '主题最多 200 字').optional(),
  body: z.string().trim().min(1, '请填写正文').max(5000, '正文最多 5000 字').optional(),
  status: status.optional(),
  variant: variant.optional(),
  versionNote: z.string().trim().max(300).optional(),
});

const parseCode = (code: string) => {
  const [, language, step, version] = TEMPLATE_CODE.exec(code)!;
  return { language: language.toLowerCase() as MailLanguage, step: Number(step), version };
};
function assertValid(step: number, subject: string, body: string) {
  const check = checkTemplate({ step, subject, body });
  if (check.errors.length) throw new HttpError(400, check.errors.join('；'));
  return check;
}

export async function listTemplates(user: Actor) {
  requireAdmin(user, '只有管理员可以管理开发信模板');
  const [templates, counts, users] = await Promise.all([
    db.radarTemplate.findMany({ orderBy: [{ language: 'asc' }, { step: 'asc' }, { code: 'asc' }] }),
    db.radarSend.groupBy({ by: ['templateId', 'status'], where: { templateId: { not: null }, status: { in: ['SENT', 'BOUNCED'] } }, _count: { _all: true } }),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(users.map(u => [u.id, u.name]));
  return templates.map(t => ({ ...t, locked: !!t.firstSentAt, createdByName: names.get(t.createdBy) ?? '',
    sent: counts.filter(c => c.templateId === t.id).reduce((sum, c) => sum + c._count._all, 0), check: checkTemplate(t) }));
}

export async function createTemplate(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以管理开发信模板');
  const v = templateInput.parse(input);
  const { language, step, version } = parseCode(v.code);
  assertValid(step, v.subject, v.body);
  try {
    return await db.radarTemplate.create({ data: { ...v, language, step, version, createdBy: user.id }, select: { id: true, code: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(409, `模板编号 ${v.code} 已存在，请换一个版本号`);
    throw error;
  }
}

export async function updateTemplate(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以管理开发信模板');
  z.string().trim().min(1).max(191).parse(id);
  const v = templatePatch.parse(input);
  const t = await db.radarTemplate.findUnique({ where: { id } });
  if (!t) throw new HttpError(404, '模板不存在');
  const words = (v.subject !== undefined && v.subject !== t.subject) || (v.body !== undefined && v.body !== t.body);
  if (words && t.firstSentAt) throw new HttpError(409, `模板 ${t.code} 已发出过，内容已锁定。要改请新建版本（如 ${t.code} → 下一个版本号）`);
  if (words) assertValid(t.step, v.subject ?? t.subject, v.body ?? t.body);
  // Locking is checked and written together: a mail that locks the template in between makes this update miss.
  const changed = await db.radarTemplate.updateMany({ where: { id, ...(words ? { firstSentAt: null } : {}) }, data: v });
  if (!changed.count) throw new HttpError(409, `模板 ${t.code} 刚刚被发出，内容已锁定，请新建版本`);
  return { id };
}

/**
 * The version a new mail of this language, step and variant uses: the testing or winning version used least so far
 * (code order breaks ties), so two versions alternate A, B, A, B. The Canton Fair variant falls back to the
 * standard one when it has no version for this step.
 */
export async function pickTemplate(client: Client, language: string, step: number, variantWanted: 'STANDARD' | 'FAIR') {
  const find = (v: string) => client.radarTemplate.findMany({ where: { language, step, variant: v, status: { in: ['TESTING', 'WINNER'] } }, orderBy: { code: 'asc' } });
  let candidates = await find(variantWanted);
  if (!candidates.length && variantWanted === 'FAIR') candidates = await find('STANDARD');
  if (!candidates.length) return null;
  const used = await client.radarSend.groupBy({ by: ['templateId'], where: { templateId: { in: candidates.map(c => c.id) }, status: { not: 'CANCELLED' } }, _count: { _all: true } });
  const uses = (id: string) => used.find(u => u.templateId === id)?._count._all ?? 0;
  return candidates.reduce((best, t) => (uses(t.id) < uses(best.id) ? t : best));
}
