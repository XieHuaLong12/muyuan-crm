import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { configSchema, gradeEnum, languageEnum, positionEnum, qualityEnum, readConfig, scriptStatusEnum } from '@/lib/outreach';

/**
 * 话术库. A script that went out once is locked: its words are what the numbers measured, so changing them means a
 * new code (T0-A1 → T0-A2), otherwise old and new data mix. Everyone reads the library; administrators edit it.
 */
const CODE = /^(T[0-4]|R[1-3])-[A-Z0-9]{1,24}$/;
const templateName = z.string().trim().max(200).nullable().default(null).transform(v => v || null);
const buttons = z.record(z.string().trim().min(1).max(100), qualityEnum).nullable().default(null)
  .transform(v => v && Object.keys(v).length ? v : null);

export const scriptInput = z.object({
  code: z.string().trim().toUpperCase().regex(CODE, '话术编号格式为 触达位置-版本，例如 T0-A1、T1-M1'),
  position: positionEnum,
  grades: z.array(gradeEnum).min(1, '请至少选择一个适用等级').max(3),
  language: languageEnum,
  content: z.string().trim().min(1, '请填写话术内容').max(4000, '话术内容不能超过 4000 字'),
  versionNote: z.string().trim().max(300, '版本说明不能超过 300 字').default(''),
  status: scriptStatusEnum.default('TESTING'),
  templateName,
  buttonQualities: buttons,
}).superRefine((v, ctx) => {
  if (!v.code.startsWith(`${v.position}-`)) ctx.addIssue({ code: 'custom', path: ['code'], message: `编号须以触达位置 ${v.position}- 开头` });
});
const scriptPatch = z.object({
  content: z.string().trim().min(1, '请填写话术内容').max(4000).optional(),
  grades: z.array(gradeEnum).min(1, '请至少选择一个适用等级').max(3).optional(),
  language: languageEnum.optional(),
  versionNote: z.string().trim().max(300).optional(),
  status: scriptStatusEnum.optional(),
  templateName: templateName.optional(),
  buttonQualities: buttons.optional(),
});

const scriptSelect = { id: true, code: true, position: true, grades: true, language: true, content: true, versionNote: true, status: true, templateName: true,
  buttonQualities: true, firstSentAt: true, createdBy: true, createdAt: true, updatedAt: true, _count: { select: { touches: true } } } satisfies Prisma.OutreachScriptSelect;

export async function listScripts(user: Actor) {
  void user;
  const [scripts, users] = await Promise.all([
    db.outreachScript.findMany({ select: scriptSelect, orderBy: [{ position: 'asc' }, { code: 'asc' }] }),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(users.map(u => [u.id, u.name]));
  return scripts.map(({ _count, ...s }) => ({ ...s, grades: s.grades.split(',').filter(Boolean), locked: !!s.firstSentAt, touches: _count.touches, createdByName: names.get(s.createdBy) ?? '' }));
}

export async function createScript(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以维护话术库');
  const v = scriptInput.parse(input);
  try {
    return await db.outreachScript.create({ data: { ...v, grades: v.grades.join(','), buttonQualities: v.buttonQualities ?? Prisma.DbNull, createdBy: user.id }, select: { id: true, code: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(409, `话术编号 ${v.code} 已存在，请换一个版本号`);
    throw error;
  }
}

export async function updateScript(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以维护话术库');
  z.string().trim().min(1).max(191).parse(id);
  const v = scriptPatch.parse(input);
  const script = await db.outreachScript.findUnique({ where: { id } });
  if (!script) throw new HttpError(404, '话术不存在');
  const sent = !!script.firstSentAt || await db.outreachTouch.count({ where: { scriptId: id } }) > 0;
  if (sent && v.content !== undefined && v.content !== script.content) throw new HttpError(409, `话术 ${script.code} 已发出过，内容已锁定。要改请新建版本（如 ${script.code} → 下一个编号）`);
  if (sent && v.language !== undefined && v.language !== script.language) throw new HttpError(409, `话术 ${script.code} 已发出过，不能再改语言`);
  // Locking is checked and written together: a send that locks the script in between makes this update miss.
  const { grades, buttonQualities, ...rest } = v;
  const changed = await db.outreachScript.updateMany({ where: { id, ...(v.content !== undefined && v.content !== script.content ? { firstSentAt: null } : {}) }, data: {
    ...rest, ...(grades ? { grades: grades.join(',') } : {}),
    ...(buttonQualities !== undefined ? { buttonQualities: buttonQualities ?? Prisma.DbNull } : {}),
  } });
  if (!changed.count) throw new HttpError(409, `话术 ${script.code} 刚刚被发出，内容已锁定，请新建版本`);
  return { id };
}

export async function outreachSettings(user: Actor) {
  void user;
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachConfig: true, outreachStartedAt: true } });
  return { config: readConfig(setting.outreachConfig), startedAt: setting.outreachStartedAt };
}

export async function saveOutreachSettings(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以修改统计参数');
  const config = configSchema.parse(input);
  await db.setting.update({ where: { id: 'system' }, data: { outreachConfig: config } });
  return { config };
}
