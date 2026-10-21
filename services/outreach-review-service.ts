import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { retryTransaction } from '@/lib/transaction-retry';
import { GRADES, MATCH_TYPES, OVERRIDE_REASONS, POSITION_LABELS, QUALITIES, SIGNALS, gradeEnum, matchTypeEnum, qualityEnum, signalEnum, type Position } from '@/lib/outreach';
import { lockCustomer } from './contact-identity-service';
import { reconcileOutreach } from './outreach-engine-service';

/**
 * 人工复核. What DeepSeek was unsure of (confidence below 0.7, a code that does not fit the touch number, no AI
 * configured), replies with photos or voice notes nobody has looked at, and grade suggestions. A person's correction
 * is applied to the record and logged in OutreachOverride with the earlier value and a reason; the numbers always use
 * the corrected value and the earlier one is never deleted.
 */
const reasonEnum = z.enum(Object.keys(OVERRIDE_REASONS) as [keyof typeof OVERRIDE_REASONS, ...(keyof typeof OVERRIDE_REASONS)[]], { errorMap: () => ({ message: '请选择修改原因' }) });
const note = z.string().trim().max(500, '备注不能超过 500 字').default('');
const id = z.string().trim().min(1).max(191);
const STALE_PENDING_MS = 10 * 60_000;

export const reviewQuery = z.object({ tab: z.enum(['touches', 'replies', 'grades', 'hot']).default('touches') });

const customerSelect = { id: true, name: true, companyName: true, country: true, leadGrade: true, owner: { select: { name: true } } } as const;

export async function reviewList(user: Actor, input: unknown = {}) {
  const { tab } = reviewQuery.parse(input);
  const visible = scope(user);
  const stale = new Date(Date.now() - STALE_PENDING_MS);
  const touchWhere: Prisma.OutreachTouchWhereInput = { customer: visible, OR: [{ judgeStatus: 'REVIEW' }, { judgeStatus: 'PENDING', createdAt: { lt: stale } }] };
  const replyWhere: Prisma.OutreachReplyWhereInput = { customer: visible, OR: [{ judgeStatus: 'REVIEW' }, { judgeStatus: 'PENDING', createdAt: { lt: stale } }] };
  const gradeWhere: Prisma.OutreachReplyWhereInput = { customer: visible, gradeSuggestionStatus: 'PENDING' };
  const hotWhere: Prisma.OutreachReplyWhereInput = { customer: { ...visible, quotedAt: null }, quality: 'HIGH', receivedAt: { lt: new Date(Date.now() - 24 * 3_600_000) } };
  const [counts, touches, replies, scripts] = await Promise.all([
    Promise.all([db.outreachTouch.count({ where: touchWhere }), db.outreachReply.count({ where: replyWhere }), db.outreachReply.count({ where: gradeWhere }),
      db.customer.count({ where: { ...visible, quotedAt: null, outreachReplies: { some: { quality: 'HIGH', receivedAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } } } })]),
    tab === 'touches' ? db.outreachTouch.findMany({ where: touchWhere, orderBy: { sentAt: 'desc' }, take: 100, include: { customer: { select: customerSelect }, script: { select: { code: true } } } }) : [],
    tab === 'replies' || tab === 'grades' || tab === 'hot' ? db.outreachReply.findMany({ where: tab === 'replies' ? replyWhere : tab === 'grades' ? gradeWhere : hotWhere,
      orderBy: { receivedAt: 'desc' }, take: 100, include: { customer: { select: customerSelect } } }) : [],
    tab === 'touches' ? db.outreachScript.findMany({ select: { id: true, code: true, position: true, language: true, status: true, content: true }, orderBy: { code: 'asc' } }) : [],
  ]);
  const users = await db.user.findMany({ select: { id: true, name: true } });
  const names = new Map(users.map(u => [u.id, u.name]));
  return {
    tab, counts: { touches: counts[0], replies: counts[1], grades: counts[2], hot: counts[3] },
    touches: touches.map(t => ({ id: t.id, customer: t.customer, code: t.code, codeLabel: POSITION_LABELS[t.code as Position] ?? t.code, sentAt: t.sentAt, channel: t.channel,
      sender: t.senderId ? names.get(t.senderId) ?? '' : '', text: t.text, scriptId: t.scriptId, scriptCode: t.script?.code ?? '', matchType: t.matchType,
      confidence: t.confidence === null ? null : Number(t.confidence), judgeStatus: t.judgeStatus, judgedBy: t.judgedBy, reason: t.judgeReason, language: t.language })),
    replies: replies.map(r => ({ id: r.id, customer: r.customer, receivedAt: r.receivedAt, text: r.text, quality: r.quality, signals: Array.isArray(r.signals) ? r.signals.map(String) : [],
      needsHuman: r.needsHuman, gradeSuggestion: r.gradeSuggestion, nextStep: r.nextStep, reason: r.reason, judgeStatus: r.judgeStatus, judgedBy: r.judgedBy })),
    scripts,
  };
}

async function visibleCustomer(customerId: string, user: Actor) {
  const customer = await db.customer.findFirst({ where: { id: customerId, ...scope(user) }, select: { id: true, leadGrade: true } });
  if (!customer) throw new HttpError(404, '记录不存在或无访问权限');
  return customer;
}

const touchCorrection = z.object({
  scriptId: z.string().trim().max(191).nullable().optional(),
  matchType: matchTypeEnum.optional(),
  /** Nothing to change: the AI was right, the record just leaves the review list. */
  confirm: z.boolean().default(false),
  reason: reasonEnum.optional(),
  note,
}).superRefine((v, ctx) => { if (!v.confirm && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: '请选择修改原因' }); });

export async function correctTouch(touchId: string, input: unknown, user: Actor) {
  id.parse(touchId);
  const v = touchCorrection.parse(input);
  const touch = await db.outreachTouch.findUnique({ where: { id: touchId }, include: { script: { select: { code: true } } } });
  if (!touch) throw new HttpError(404, '记录不存在或无访问权限');
  await visibleCustomer(touch.customerId, user);
  const script = v.scriptId ? await db.outreachScript.findUnique({ where: { id: v.scriptId } }) : null;
  if (v.scriptId && !script) throw new HttpError(400, '话术不存在');
  if (script && script.position !== touch.code) throw new HttpError(400, `这次是 ${touch.code}，只能选 ${touch.code} 的话术`);
  const changes: { field: string; oldValue: string; newValue: string }[] = [];
  if (v.scriptId !== undefined && (v.scriptId || null) !== touch.scriptId) changes.push({ field: 'SCRIPT', oldValue: touch.script?.code ?? '', newValue: script?.code ?? '' });
  if (v.matchType && v.matchType !== touch.matchType) changes.push({ field: 'MATCH_TYPE', oldValue: touch.matchType, newValue: v.matchType });
  if (!changes.length && !v.confirm) throw new HttpError(400, '没有需要修改的内容');
  const matchType = v.matchType ?? touch.matchType;
  if (!matchType) throw new HttpError(400, '请选择匹配类型');
  if (['EXACT', 'LIGHT', 'HEAVY'].includes(matchType) && !(v.scriptId !== undefined ? v.scriptId : touch.scriptId)) throw new HttpError(400, `匹配类型为「${MATCH_TYPES[matchType as keyof typeof MATCH_TYPES]}」时请选择话术`);
  await retryTransaction(() => db.$transaction(async tx => {
    await lockCustomer(tx, touch.customerId);
    for (const change of changes) await tx.outreachOverride.create({ data: { touchId, ...change, reason: v.reason!, note: v.note, aiOriginal: touch.judgedBy === 'AI', actorId: user.id } });
    await tx.outreachTouch.update({ where: { id: touchId }, data: {
      ...(v.scriptId !== undefined ? { scriptId: matchType === 'FREE' ? null : v.scriptId || null } : {}), matchType, judgeStatus: 'DONE',
      ...(changes.length ? { judgedBy: 'HUMAN', humanEdited: true } : {}) } });
    if (script) await tx.outreachScript.updateMany({ where: { id: script.id, firstSentAt: null }, data: { firstSentAt: new Date() } });
  }));
  await reconcileOutreach(touch.customerId);
  return { id: touchId, changed: changes.length };
}

const replyCorrection = z.object({
  quality: qualityEnum.optional(),
  signals: z.array(signalEnum).max(20).optional(),
  confirm: z.boolean().default(false),
  reason: reasonEnum.optional(),
  note,
}).superRefine((v, ctx) => { if (!v.confirm && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: '请选择修改原因' }); });

export async function correctReply(replyId: string, input: unknown, user: Actor) {
  id.parse(replyId);
  const v = replyCorrection.parse(input);
  const reply = await db.outreachReply.findUnique({ where: { id: replyId } });
  if (!reply) throw new HttpError(404, '记录不存在或无访问权限');
  await visibleCustomer(reply.customerId, user);
  const before = Array.isArray(reply.signals) ? reply.signals.map(String).sort() : [];
  const changes: { field: string; oldValue: string; newValue: string }[] = [];
  if (v.quality && v.quality !== reply.quality) changes.push({ field: 'QUALITY', oldValue: reply.quality, newValue: v.quality });
  if (v.signals && [...v.signals].sort().join(',') !== before.join(',')) changes.push({ field: 'SIGNALS', oldValue: before.join(','), newValue: [...v.signals].sort().join(',') });
  if (!changes.length && !v.confirm) throw new HttpError(400, '没有需要修改的内容');
  await retryTransaction(() => db.$transaction(async tx => {
    await lockCustomer(tx, reply.customerId);
    for (const change of changes) await tx.outreachOverride.create({ data: { replyId, ...change, reason: v.reason!, note: v.note, aiOriginal: reply.judgedBy === 'AI', actorId: user.id } });
    await tx.outreachReply.update({ where: { id: replyId }, data: { ...(v.quality ? { quality: v.quality } : {}), ...(v.signals ? { signals: v.signals } : {}),
      judgeStatus: 'DONE', ...(changes.length ? { judgedBy: 'HUMAN', humanEdited: true } : {}) } });
  }));
  // The state may change: a corrected refusal, a stop request, an auto-reply that was a real answer.
  await reconcileOutreach(reply.customerId);
  return { id: replyId, changed: changes.length };
}

const gradeDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ACCEPT'), replyId: id }),
  z.object({ action: z.literal('DISMISS'), replyId: id, reason: reasonEnum, note }),
  z.object({ action: z.literal('SET'), customerId: id, grade: gradeEnum, note }),
]);

/**
 * Grades: accept DeepSeek's suggestion with one click, dismiss it (logged as a correction of the AI), or set the grade
 * by hand. A grade a person set (leadGradeSource HUMAN) is not overwritten by later automatic grading.
 */
export async function decideGrade(input: unknown, user: Actor) {
  const v = gradeDecision.parse(input);
  const reply = v.action === 'SET' ? null : await db.outreachReply.findUnique({ where: { id: v.replyId } });
  if (v.action !== 'SET' && (!reply || reply.gradeSuggestionStatus !== 'PENDING')) throw new HttpError(409, '这条等级建议已处理过');
  const customerId = v.action === 'SET' ? v.customerId : reply!.customerId;
  await visibleCustomer(customerId, user);
  const now = new Date();
  await retryTransaction(() => db.$transaction(async tx => {
    await lockCustomer(tx, customerId);
    const current = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { updatedAt: true, leadGrade: true } });
    const setGrade = (grade: string, why: string) => tx.customer.update({ where: { id: customerId }, data: {
      leadGrade: grade, leadGradeSource: 'HUMAN', leadGradeReason: why.slice(0, 500), leadGradedAt: now, updatedAt: current.updatedAt } });
    if (v.action === 'ACCEPT') {
      await setGrade(reply!.gradeSuggestion, `${user.name} 确认 AI 根据客户回复给出的建议（原 ${current.leadGrade || '未评级'}）：${reply!.reason}`);
      await tx.outreachReply.update({ where: { id: reply!.id }, data: { gradeSuggestionStatus: 'ACCEPTED' } });
    } else if (v.action === 'DISMISS') {
      await tx.outreachOverride.create({ data: { replyId: reply!.id, field: 'GRADE', oldValue: reply!.gradeSuggestion, newValue: current.leadGrade, reason: v.reason, note: v.note, aiOriginal: true, actorId: user.id } });
      await tx.outreachReply.update({ where: { id: reply!.id }, data: { gradeSuggestionStatus: 'DISMISSED' } });
    } else {
      await setGrade(v.grade, `${user.name} 手动调整（原 ${current.leadGrade || '未评级'}）${v.note ? `：${v.note}` : ''}`);
      // A pending suggestion is settled by the manual grade: accepted when it says the same, dismissed otherwise.
      await tx.outreachReply.updateMany({ where: { customerId, gradeSuggestionStatus: 'PENDING', gradeSuggestion: v.grade }, data: { gradeSuggestionStatus: 'ACCEPTED' } });
      await tx.outreachReply.updateMany({ where: { customerId, gradeSuggestionStatus: 'PENDING' }, data: { gradeSuggestionStatus: 'DISMISSED' } });
    }
  }));
  return { customerId, grade: v.action === 'SET' ? v.grade : v.action === 'ACCEPT' ? reply!.gradeSuggestion : null };
}

export const REVIEW_LABELS = { qualities: QUALITIES, signals: SIGNALS, matchTypes: MATCH_TYPES, reasons: OVERRIDE_REASONS, grades: GRADES };
