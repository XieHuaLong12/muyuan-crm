import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { retryTransaction } from '@/lib/transaction-retry';
import { afterResponse } from '@/lib/after-response';
import { isTerminalStage } from '@/lib/constants';
import {
  COUNTED_MATCHES, DAY, HOUR, OUTREACH_STATES, POSITION_LABELS, QUALITIES, SCRIPT_STATUSES, customerScriptLanguage, deriveOutreach, groupChannel, groupHasMedia,
  groupHasWords, groupMessages, groupText, matchesExactly, readConfig, renderScript, ruleReply,
  type Derivation, type FlowMessage, type MessageGroup, type OutreachConfig, type Position, type Quality, type ReplyVerdict,
} from '@/lib/outreach';
import { accessible } from './customer-service';
import { lockCustomer } from './contact-identity-service';
import { automatedTask, resolveRule } from './workflow-service';
import { deepSeekConfigured } from './deepseek-customer-service';
import { firstNameOf, productLineOf } from './whatsapp-template-service';

/**
 * The outreach engine: for one customer, from the messages alone, which groups were touches (T0–T4, R1–R3), which
 * script each used, which reply answered which touch, and where the conversation stands now. It recomputes from the
 * whole history every time (a customer has dozens of messages, not thousands), so messages arriving late or out of
 * order, a human correction or a new AI verdict all end in the same records. Records are keyed by the first message
 * of each group and only exist from the day the feature started (Setting.outreachStartedAt); older messages only
 * tell the engine the current state. The AI is never called while a transaction is open.
 */

type Tx = Prisma.TransactionClient;
const STALE_CLAIM_MS = 10 * 60_000;
const hash = (group: MessageGroup) => createHash('sha256').update(group.messages.map(m => `${m.id}:${m.content}`).join('\n')).digest('hex');
const gradeOf = (grade: string) => ['A', 'B', 'C'].includes(grade) ? grade : '';

/** The parameters and the day records start, written once on the first run (two first runs agree on one value). */
export async function outreachSetup(client: Tx | typeof db = db) {
  const setting = await client.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachConfig: true, outreachStartedAt: true } });
  let startedAt = setting.outreachStartedAt;
  if (!startedAt) {
    await client.setting.updateMany({ where: { id: 'system', outreachStartedAt: null }, data: { outreachStartedAt: new Date() } });
    startedAt = (await client.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachStartedAt: true } })).outreachStartedAt!;
  }
  return { config: readConfig(setting.outreachConfig), startedAt };
}

type Scripts = Awaited<ReturnType<typeof loadScripts>>;
const loadScripts = (client: Tx | typeof db) => client.outreachScript.findMany({ select: { id: true, code: true, position: true, grades: true, language: true,
  content: true, status: true, templateName: true, buttonQualities: true, firstSentAt: true }, orderBy: { code: 'asc' } });

async function loadMessages(client: Tx | typeof db, customerId: string) {
  const rows = await client.whatsAppMessage.findMany({ where: { customerId, direction: { in: ['INBOUND', 'OUTBOUND'] }, status: { notIn: ['FAILED', 'PENDING'] } },
    select: { id: true, direction: true, sentAt: true, content: true, messageType: true, requestId: true, sentById: true, source: true, providerAccountId: true },
    orderBy: [{ sentAt: 'asc' }, { id: 'asc' }] });
  const templates = rows.filter(r => r.messageType.toUpperCase() === 'TEMPLATE').map(r => r.id);
  const raws = templates.length ? await client.whatsAppMessage.findMany({ where: { id: { in: templates } }, select: { id: true, raw: true } }) : [];
  const names = new Map(raws.map(r => {
    try { return [r.id, String((JSON.parse(r.raw) as { template?: { name?: unknown } }).template?.name ?? '') || null] as const; } catch { return [r.id, null] as const; }
  }));
  const meta = new Map(rows.map(r => [r.id, { source: r.source, account: r.providerAccountId }]));
  const messages: FlowMessage[] = rows.map(r => ({ id: r.id, direction: r.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND', sentAt: r.sentAt, content: r.content,
    messageType: r.messageType, bos: !!r.requestId, templateName: names.get(r.id) ?? null, senderId: r.sentById }));
  return { messages, meta };
}

/** A template quick-reply button pressed by the customer, judged by what the library registered for it. */
function buttonVerdict(group: MessageGroup, scripts: Scripts): Quality | null {
  if (group.messages.length !== 1) return null;
  const text = group.messages[0].content.trim().toLowerCase();
  for (const script of scripts) {
    const map = script.buttonQualities as Record<string, Quality> | null;
    const hit = map && Object.entries(map).find(([button]) => button.trim().toLowerCase() === text);
    if (hit) return hit[1];
  }
  return null;
}

type ReplyRow = { groupKey: string; quality: string; signals: Prisma.JsonValue; contentHash: string; humanEdited: boolean };
/** The verdict the state machine uses: the stored judgement while the group is unchanged, else the rules. */
function verdictFor(group: MessageGroup, stored: ReplyRow | undefined, scripts: Scripts): ReplyVerdict & { signals: string[]; judgedBy: string; reason: string; needsHuman: boolean } {
  const media = groupHasMedia(group);
  if (stored && stored.quality && (stored.humanEdited || stored.contentHash === hash(group))) {
    const signals = Array.isArray(stored.signals) ? stored.signals.map(String) : [];
    return { quality: stored.quality as Quality, stop: signals.includes('STOP_CONTACT'), signals, judgedBy: '', reason: '', needsHuman: media };
  }
  const button = buttonVerdict(group, scripts);
  if (button) return { quality: button, stop: false, signals: [], judgedBy: 'BUTTON', reason: '模板快捷按钮，按话术库登记的对应关系判定', needsHuman: false };
  const rule = ruleReply(groupText(group), media, groupHasWords(group));
  return { quality: rule.quality, stop: rule.signals.includes('STOP_CONTACT'), signals: rule.signals, judgedBy: 'RULE', reason: rule.reason, needsHuman: media };
}

/** Phone sends: the salesperson who authorised that number for local sync; on the shared company number, the owner. */
async function phoneSender(client: Tx, source: string, account: string | null, ownerId: string) {
  if (source === 'whatsapp_web' && account) {
    const token = await client.whatsAppSyncToken.findFirst({ where: { accountPhone: account }, orderBy: { createdAt: 'desc' }, select: { userId: true } });
    if (token) return token.userId;
  }
  return ownerId;
}

/**
 * Which script a touch used, by rules only: a registered template carries its code; text identical to a script of
 * the same position and language (apart from punctuation, spacing and variables) is "原样". Anything else waits for
 * the AI (or a person when the AI is not configured).
 */
function resolveScript(group: MessageGroup, code: Position, language: string, scripts: Scripts) {
  const channel = groupChannel(group);
  const templateName = group.messages.find(m => m.templateName)?.templateName;
  if (channel === 'BOS_TEMPLATE') {
    const script = templateName ? scripts.find(s => s.templateName === templateName) : undefined;
    return script
      ? { scriptId: script.id, matchType: 'EXACT', confidence: 1, judgeStatus: script.position === code ? 'DONE' : 'REVIEW', judgedBy: 'RULE',
        judgeReason: script.position === code ? `BOS 模板 ${templateName}，话术库登记为 ${script.code}` : `模板登记为 ${script.code}，但这次是 ${code}，序号对不上` }
      : { scriptId: null, matchType: 'FREE', confidence: 1, judgeStatus: 'DONE', judgedBy: 'RULE', judgeReason: `模板 ${templateName ?? ''} 没有登记到话术库，归入非标准话术` };
  }
  const text = groupText(group);
  const exact = scripts.find(s => s.position === code && s.language === language && matchesExactly(text, s.content));
  if (exact) return { scriptId: exact.id, matchType: 'EXACT', confidence: 1, judgeStatus: 'DONE', judgedBy: 'RULE', judgeReason: `与话术 ${exact.code} 原文一致` };
  return { scriptId: null, matchType: '', confidence: null, judgeStatus: deepSeekConfigured() ? 'PENDING' : 'REVIEW', judgedBy: '',
    judgeReason: deepSeekConfigured() ? '等待 DeepSeek 识别话术' : '未配置 DeepSeek，请人工选择话术' };
}

export type Reconciled = { state: string; next: Position | ''; cycle: number; nextTouchAt: Date | null; pendingAi: number; derivation: Derivation };

/**
 * Recompute one customer inside a transaction that holds the customer row (lock order as everywhere: Customer, then
 * Task, then Reminder). Returns null for a deleted or unknown customer.
 */
async function reconcileIn(tx: Tx, customerId: string, now: Date, setup: { config: OutreachConfig; startedAt: Date }): Promise<Reconciled | null> {
  await lockCustomer(tx, customerId);
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, ownerId: true, leadGrade: true, language: true, stage: true,
    deletedAt: true, createdAt: true, updatedAt: true, whatsappOptInStatus: true, outreachState: true, outreachNext: true, outreachDueAt: true, replyScriptCode: true, bestReplyQuality: true } });
  if (!customer || customer.deletedAt) return null;
  const { config, startedAt } = setup;
  const [{ messages, meta }, scripts, touchRows, replyRows] = await Promise.all([
    loadMessages(tx, customerId), loadScripts(tx),
    tx.outreachTouch.findMany({ where: { customerId } }),
    tx.outreachReply.findMany({ where: { customerId } }),
  ]);
  const groups = groupMessages(messages, config.groupMinutes);
  const byKey = new Map(groups.map(g => [g.key, g]));
  const storedReplies = new Map(replyRows.map(r => [r.groupKey, r]));
  const verdicts = new Map(groups.filter(g => g.direction === 'INBOUND').map(g => [g.key, verdictFor(g, storedReplies.get(g.key), scripts)]));
  const derivation = deriveOutreach(groups, key => verdicts.get(key) ?? null, config, now);
  const recorded = (at: Date) => at.getTime() >= startedAt.getTime();
  const language = customerScriptLanguage(customer.language);

  // Replies: one row per customer group since the start; a group that grew is judged again (unless a person judged it).
  for (const group of groups) {
    if (group.direction !== 'INBOUND' || !recorded(group.at)) continue;
    const stored = storedReplies.get(group.key), verdict = verdicts.get(group.key)!, contentHash = hash(group);
    const fresh = !stored || (!stored.humanEdited && stored.contentHash !== contentHash);
    const ai = deepSeekConfigured() && verdict.judgedBy === 'RULE' && groupHasWords(group);
    const judgement = { quality: verdict.quality, signals: verdict.signals, needsHuman: verdict.needsHuman, reason: verdict.reason, judgedBy: verdict.judgedBy,
      judgeStatus: ai ? 'PENDING' : verdict.needsHuman ? 'REVIEW' : 'DONE', judgedAt: ai ? null : now, gradeSuggestion: '', gradeSuggestionStatus: '', nextStep: '' };
    const base = { receivedAt: group.at, text: groupText(group).slice(0, 8000), contentHash, messageCount: group.messages.length };
    if (!stored) await tx.outreachReply.create({ data: { groupKey: group.key, customerId, ...base, ...judgement } });
    else await tx.outreachReply.update({ where: { id: stored.id }, data: { ...base, ...(fresh ? judgement : {}) } });
  }

  // Touches.
  const storedTouches = new Map(touchRows.map(t => [t.groupKey, t]));
  const replyIds = new Map((await tx.outreachReply.findMany({ where: { customerId }, select: { id: true, groupKey: true, quality: true, signals: true } })).map(r => [r.groupKey, r]));
  const assignments = await tx.outreachAssignment.findMany({ where: { customerId } });
  const lockScripts = new Set<string>();
  const live = new Set<string>();
  for (const touch of derivation.touches) {
    if (!recorded(touch.at)) continue;
    live.add(touch.key);
    const group = byKey.get(touch.key)!, stored = storedTouches.get(touch.key), contentHash = hash(group);
    const assignment = assignments.find(a => a.position === touch.code && a.cycle === touch.cycle);
    const reply = touch.replyKey ? replyIds.get(touch.replyKey) : undefined;
    const derived = { kind: touch.kind, code: touch.code, cycle: touch.cycle, sentAt: touch.at, windowOpen: touch.windowOpen, tooSoon: touch.tooSoon,
      channel: groupChannel(group), text: groupText(group).slice(0, 8000), contentHash, messageCount: group.messages.length,
      replyId: reply?.id ?? null, repliedAt: touch.repliedAt, replied24h: touch.replied24h, lateReply: touch.lateReply,
      replyQuality: reply?.quality ?? '', replySignals: reply?.signals ?? Prisma.DbNull };
    const needsResolve = !stored || (!stored.humanEdited && (stored.contentHash !== contentHash || stored.code !== touch.code));
    let resolution = {};
    if (needsResolve) {
      const script = resolveScript(group, touch.code, language, scripts);
      const senderId = group.messages.find(m => m.senderId)?.senderId
        ?? (derived.channel === 'PHONE' ? await phoneSender(tx, meta.get(group.key)?.source ?? '', meta.get(group.key)?.account ?? null, customer.ownerId) : customer.ownerId);
      const used = script.scriptId ? scripts.find(s => s.id === script.scriptId) : undefined;
      resolution = { ...script, senderId, judgedAt: script.judgeStatus === 'PENDING' ? null : now,
        grade: assignment?.grade ?? gradeOf(customer.leadGrade), language: used?.language ?? assignment?.language ?? language };
      if (script.scriptId) lockScripts.add(script.scriptId);
    }
    const row = stored
      ? await tx.outreachTouch.update({ where: { id: stored.id }, data: { ...derived, ...resolution, ...(stored.judgeStatus === 'VOID' ? { judgeStatus: stored.humanEdited ? 'DONE' : 'PENDING' } : {}) } })
      : await tx.outreachTouch.create({ data: { groupKey: touch.key, customerId, ...derived, ...(resolution as { judgeStatus: string }) } });
    if (row.scriptId) lockScripts.add(row.scriptId);
    if (assignment && assignment.touchId !== row.id) await tx.outreachAssignment.update({ where: { id: assignment.id }, data: { touchId: row.id } });
    // (NOT x in SQL skips NULL, so an unlinked reply is matched explicitly.)
    if (reply) await tx.outreachReply.updateMany({ where: { id: reply.id, OR: [{ touchId: null }, { touchId: { not: row.id } }] }, data: { touchId: row.id } });
  }
  // Replies no longer answering a touch (a correction moved the attribution) lose the link.
  const linked = new Set([...derivation.replyTouch.keys()]);
  await tx.outreachReply.updateMany({ where: { customerId, touchId: { not: null }, groupKey: { notIn: [...linked] } }, data: { touchId: null } });
  // Touches the history no longer supports (a correction made the customer's earlier message a real reply): records a
  // person corrected stay, voided, so the correction log keeps its subject; the rest go.
  for (const stale of touchRows.filter(t => !live.has(t.groupKey) && recorded(t.sentAt))) {
    if (stale.humanEdited) await tx.outreachTouch.update({ where: { id: stale.id }, data: { judgeStatus: 'VOID' } });
    else { await tx.outreachAssignment.updateMany({ where: { touchId: stale.id }, data: { touchId: null } }); await tx.outreachTouch.delete({ where: { id: stale.id } }); }
  }
  // A script that went out is locked from now on.
  for (const id of [...lockScripts].sort()) await tx.outreachScript.updateMany({ where: { id, firstSentAt: null }, data: { firstSentAt: now } });

  // The customer's outreach fields. Not an edit: updatedAt stays, as for grades.
  const firstAnswered = derivation.firstAnsweredTouch ? await tx.outreachTouch.findUnique({ where: { groupKey: derivation.firstAnsweredTouch }, select: { script: { select: { code: true } } } }) : null;
  const fields = { outreachState: derivation.state, outreachNext: derivation.next, outreachDueAt: derivation.dueAt,
    replyScriptCode: firstAnswered?.script?.code ?? customer.replyScriptCode, bestReplyQuality: derivation.bestQuality };
  const stopNow = derivation.state === 'STOPPED' && customer.whatsappOptInStatus !== 'OPTED_OUT';
  await tx.customer.update({ where: { id: customerId }, data: { ...fields, updatedAt: customer.updatedAt,
    ...(stopNow ? { whatsappOptInStatus: 'OPTED_OUT', whatsappOptOutAt: now } : {}) } });
  if (stopNow) await tx.identityAudit.create({ data: { entityType: 'WHATSAPP_CONSENT', entityId: customerId, actorId: 'SYSTEM', reason: '回复判定：客户要求停止联系' } });

  // The next touch: a script from the rotation and a follow-up task, for rounds that started after records began.
  const fresh = freshRound(derivation, customer.createdAt, startedAt);
  if (derivation.next && fresh) await assignScript(tx, { id: customerId, leadGrade: customer.leadGrade, language: customer.language }, derivation.next, derivation.cycle, config);
  await syncFollowUpTask(tx, customer, derivation, fresh);

  const pendingAi = await tx.outreachTouch.count({ where: { customerId, judgeStatus: 'PENDING' } }) + await tx.outreachReply.count({ where: { customerId, judgeStatus: 'PENDING' } });
  return { state: derivation.state, next: derivation.next, cycle: derivation.cycle, nextTouchAt: derivation.nextTouchAt, pendingAi, derivation };
}

/** Rounds that began before records started (old leads, old silences) get no rotation and no new tasks. */
function freshRound(d: Derivation, createdAt: Date, startedAt: Date) {
  if (d.next === 'T0') return createdAt >= startedAt;
  const round = d.touches.filter(t => t.cycle === d.cycle && (d.next.startsWith('T') ? t.kind === 'ICEBREAK' : t.kind === 'REVIVE'));
  if (d.next.startsWith('T')) return !!round[0] && round[0].at >= startedAt;
  // A silence: fresh when it began after the start (no R yet, or the round's first R after the start).
  return round.length ? round[0].at >= startedAt : !!d.nextTouchAt && d.nextTouchAt >= startedAt;
}

/**
 * The script for a customer's next touch: among the 测试中 and 胜出 scripts for that position, grade and language
 * (English when none exists in the customer's language), the one assigned least so far, the lower code first on a
 * tie: A1, A2, A1, A2… Salespeople do not choose. D leads get none; ungraded leads rotate in their own group.
 */
export async function assignScript(tx: Tx, customer: { id: string; leadGrade: string; language: string }, position: Position, cycle: number, config?: OutreachConfig) {
  void config;
  const existing = await tx.outreachAssignment.findUnique({ where: { customerId_position_cycle: { customerId: customer.id, position, cycle } }, include: { script: true } });
  if (existing) return existing;
  if (customer.leadGrade === 'D') return null;
  const grade = gradeOf(customer.leadGrade);
  const active = await tx.outreachScript.findMany({ where: { position, status: { in: ['TESTING', 'WINNER'] } }, orderBy: { code: 'asc' } });
  const fits = (language: string) => active.filter(s => s.language === language && (!grade || s.grades.split(',').includes(grade)));
  const wanted = customerScriptLanguage(customer.language);
  const candidates = fits(wanted).length ? fits(wanted) : fits('en');
  if (!candidates.length) return null;
  const language = candidates[0].language;
  const counts = await tx.outreachAssignment.groupBy({ by: ['scriptId'], where: { position, grade, language, scriptId: { in: candidates.map(c => c.id) } }, _count: { _all: true } });
  const count = (id: string) => counts.find(c => c.scriptId === id)?._count._all ?? 0;
  const pick = [...candidates].sort((a, b) => count(a.id) - count(b.id) || a.code.localeCompare(b.code))[0];
  try {
    return await tx.outreachAssignment.create({ data: { customerId: customer.id, position, cycle, scriptId: pick.id, grade, language }, include: { script: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return tx.outreachAssignment.findUnique({ where: { customerId_position_cycle: { customerId: customer.id, position, cycle } }, include: { script: true } });
    throw error;
  }
}

/** T1–T4 on days 1 / 3 / 7 / 14 after T0, R1–R3 on days 0 / 3 / 7 of a silence; none once dormant or stopped. */
async function syncFollowUpTask(tx: Tx, customer: { id: string; name: string; ownerId: string; leadGrade: string; stage: string }, d: Derivation, fresh: boolean) {
  const prefix = `outreach:${customer.id}:`;
  const due = fresh && d.next && d.next !== 'T0' && d.nextTouchAt && (d.state === 'ICEBREAK' || d.state === 'SILENT') && !isTerminalStage(customer.stage);
  const key = due ? `${prefix}${d.cycle}:${d.next}` : undefined;
  await resolveRule(tx, customer.id, prefix, key);
  if (!due || !key) return;
  const assignment = await tx.outreachAssignment.findUnique({ where: { customerId_position_cycle: { customerId: customer.id, position: d.next as Position, cycle: d.cycle } }, include: { script: { select: { code: true } } } });
  await automatedTask(tx, { customerId: customer.id, createdBy: customer.ownerId, type: 'FOLLOW_UP', dueDate: d.nextTouchAt!, automationKey: key, source: 'OUTREACH',
    priority: customer.leadGrade === 'A' ? 'HIGH' : 'MEDIUM',
    title: `${POSITION_LABELS[d.next as Position]}：${customer.name}`,
    description: assignment ? `系统分配话术 ${assignment.script.code}。在消息中心打开聊天即可带出话术；窗口外只能发已审核模板。` : '话术库里还没有这个位置可用的话术，请按跟进节奏发送并记录。' });
}

/** Recompute a customer now (rules only). Errors are logged, never thrown into the message path that called it. */
export async function reconcileOutreach(customerId: string, now = new Date()) {
  const setup = await outreachSetup();
  return retryTransaction(() => db.$transaction(tx => reconcileIn(tx, customerId, now, setup), { timeout: 20_000, maxWait: 10_000 }));
}

/**
 * Recompute, let DeepSeek read what the rules could not (which script a phone message used, how good a reply is),
 * then recompute again: a refusal or a stop request changes the state.
 */
export async function processOutreach(customerId: string, options: { ai?: boolean; now?: Date } = {}) {
  const now = options.now ?? new Date();
  let result = await reconcileOutreach(customerId, now);
  if (result && result.pendingAi && options.ai !== false && deepSeekConfigured()) {
    const { judgePending } = await import('./outreach-ai-service');
    const judged = await judgePending(customerId);
    if (judged) result = await reconcileOutreach(customerId, now);
  }
  return result;
}

/** After messages were stored: each customer in turn, failures logged so the rest still run. */
export async function processOutreachQuietly(customerIds: Iterable<string>, options: { ai?: boolean } = {}) {
  for (const id of new Set(customerIds)) {
    try { await processOutreach(id, options); }
    catch (error) { console.error('[outreach] RETRY_PENDING', error instanceof Error ? error.message : 'unknown'); }
  }
}

/** For send paths: recompute at once without the AI, then let the AI read it after the response. */
export async function outreachAfterSend(customerId: string) {
  try { await reconcileOutreach(customerId); }
  catch (error) { console.error('[outreach] after send', error instanceof Error ? error.message : 'unknown'); }
  if (deepSeekConfigured()) afterResponse(() => processOutreach(customerId));
}

/**
 * Scheduled safety net (every 5 minutes with the lead job): customers whose state changes with time now, judgements
 * still waiting for the AI (claims older than 10 minutes are retried), and customers never computed. Bounded per run.
 */
export async function outreachSweep(limit = 40, now = new Date()) {
  await outreachSetup();
  const staleClaim = new Date(now.getTime() - STALE_CLAIM_MS);
  const pendingWhere = { judgeStatus: 'PENDING', OR: [{ judgedAt: null }, { judgedAt: { lt: staleClaim } }] };
  const [due, touches, replies, never] = await Promise.all([
    db.customer.findMany({ where: { deletedAt: null, outreachDueAt: { lte: now } }, select: { id: true }, orderBy: { outreachDueAt: 'asc' }, take: limit }),
    deepSeekConfigured() ? db.outreachTouch.findMany({ where: pendingWhere, select: { customerId: true }, distinct: ['customerId'], take: limit }) : [],
    deepSeekConfigured() ? db.outreachReply.findMany({ where: pendingWhere, select: { customerId: true }, distinct: ['customerId'], take: limit }) : [],
    db.customer.findMany({ where: { deletedAt: null, outreachState: '' }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: limit }),
  ]);
  const ids = [...new Set([...due.map(c => c.id), ...touches.map(t => t.customerId), ...replies.map(r => r.customerId), ...never.map(c => c.id)])].slice(0, limit * 2);
  let processed = 0;
  for (const id of ids) {
    try { await processOutreach(id, { now }); processed++; }
    catch (error) { console.error('[outreach] sweep', error instanceof Error ? error.message : 'unknown'); }
  }
  return { processed };
}

// ───────────────────────── Sending ─────────────────────────

/**
 * Before BOS sends anything: a customer who asked us to stop gets nothing; a template that would be a touch (breaking
 * the ice or waking a silence) waits 24 hours after the previous touch, and at most two templates go out until the
 * customer really answers.
 */
export async function outreachSendGuard(customerId: string, kind: 'TEMPLATE' | 'FREE', now = new Date()) {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { outreachState: true } });
  if (customer?.outreachState === 'STOPPED') throw new HttpError(409, '客户已要求停止联系，BOS 不再向这位客户发送主动消息');
  if (kind !== 'TEMPLATE') return;
  const { config } = await outreachSetup();
  const [{ messages }, replies, scripts] = await Promise.all([loadMessages(db, customerId), db.outreachReply.findMany({ where: { customerId } }), loadScripts(db)]);
  const groups = groupMessages(messages, config.groupMinutes);
  const stored = new Map(replies.map(r => [r.groupKey, r]));
  const d = deriveOutreach(groups, key => { const g = groups.find(x => x.key === key)!; return verdictFor(g, stored.get(key), scripts); }, config, now);
  if (d.state === 'STOPPED') throw new HttpError(409, '客户已要求停止联系，BOS 不再向这位客户发送主动消息');
  if (d.state !== 'ICEBREAK' && d.state !== 'SILENT') return;
  if (d.lastTouchAt && now.getTime() - d.lastTouchAt.getTime() < config.minTouchGapHours * HOUR) {
    const wait = new Date(d.lastTouchAt.getTime() + config.minTouchGapHours * HOUR);
    throw new HttpError(409, `距上次主动触达不足 ${config.minTouchGapHours} 小时，窗口外两次主动触达至少间隔 ${config.minTouchGapHours} 小时（${wait.toISOString().slice(5, 16).replace('T', ' ')} UTC 后可发）`);
  }
  if (d.templatesSinceReply >= config.templateCap) throw new HttpError(409, `这位客户已收到 ${d.templatesSinceReply} 条模板消息还没回复，同一线索模板消息最多 ${config.templateCap} 条，后续请用手机跟进`);
}

// ───────────────────────── Next touch (chat window) ─────────────────────────

export async function outreachNextView(input: unknown, user: Actor) {
  const { customerId } = z.object({ customerId: z.string().trim().min(1).max(191) }).parse(input);
  await accessible(customerId, user);
  const result = await reconcileOutreach(customerId);
  if (!result) throw new HttpError(404, '客户不存在或无访问权限');
  // Opening the chat is the salesperson starting this touch: the script is assigned now even for older leads.
  const assignment = result.next && (result.state === 'ICEBREAK' || result.state === 'SILENT')
    ? await retryTransaction(() => db.$transaction(async tx => {
      await lockCustomer(tx, customerId);
      const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { id: true, leadGrade: true, language: true } });
      return assignScript(tx, c, result.next as Position, result.cycle);
    })) : null;
  return outreachView(customerId, result, assignment);
}

async function outreachView(customerId: string, result: Reconciled, assignment: Awaited<ReturnType<typeof assignScript>>) {
  const { config } = await outreachSetup();
  const c = await db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { name: true, country: true, sourceDetail: true, productInterest: true, productModel: true,
    leadGrade: true, leadGradeSource: true, replyScriptCode: true, bestReplyQuality: true, owner: { select: { name: true } } } });
  const suggestion = await db.outreachReply.findFirst({ where: { customerId, gradeSuggestionStatus: 'PENDING' }, orderBy: { receivedAt: 'desc' },
    select: { id: true, gradeSuggestion: true, reason: true, nextStep: true, receivedAt: true } });
  const latest = await db.outreachReply.findFirst({ where: { customerId, quality: { not: 'INVALID' }, nextStep: { not: '' } }, orderBy: { receivedAt: 'desc' }, select: { nextStep: true, quality: true } });
  const d = result.derivation;
  const script = assignment?.script;
  const facts = { firstName: firstNameOf(c.name), country: c.country, product: productLineOf(c.sourceDetail, c.productInterest, c.productModel), owner: c.owner.name };
  const waitUntil = d.lastTouchAt && (d.state === 'ICEBREAK' || d.state === 'SILENT') ? new Date(d.lastTouchAt.getTime() + config.minTouchGapHours * HOUR) : null;
  return {
    state: result.state, stateLabel: OUTREACH_STATES[result.state as keyof typeof OUTREACH_STATES] ?? '—',
    next: result.next, nextLabel: result.next ? POSITION_LABELS[result.next] : '', nextTouchAt: result.nextTouchAt,
    script: script ? { id: script.id, code: script.code, status: script.status, statusLabel: SCRIPT_STATUSES[script.status as keyof typeof SCRIPT_STATUSES] ?? script.status,
      templateName: script.templateName, content: script.content, rendered: renderScript(script.content, facts) } : null,
    limits: { stopped: result.state === 'STOPPED', waitUntil: waitUntil && waitUntil > new Date() ? waitUntil : null,
      templatesLeft: Math.max(0, config.templateCap - d.templatesSinceReply), templateCap: config.templateCap },
    grade: c.leadGrade, gradeSource: c.leadGradeSource, replyScriptCode: c.replyScriptCode,
    bestReplyQuality: c.bestReplyQuality, bestReplyLabel: c.bestReplyQuality ? QUALITIES[c.bestReplyQuality as Quality] : '',
    nextStep: latest?.nextStep ?? '',
    gradeSuggestion: suggestion && suggestion.gradeSuggestion !== c.leadGrade ? suggestion : null,
  };
}
export type OutreachNextView = Awaited<ReturnType<typeof outreachView>>;

/** Touches that count towards a script's numbers: settled, the script identified, sent as written or lightly edited. */
export const countedTouch = { matchType: { in: [...COUNTED_MATCHES] }, scriptId: { not: null }, judgeStatus: 'DONE' } satisfies Prisma.OutreachTouchWhereInput;
export const DAY_MS = DAY;
