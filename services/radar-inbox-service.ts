import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { openSecret } from '@/lib/secret';
import { retryTransaction } from '@/lib/transaction-retry';
import { GmailError, accessToken, getMessage, gmailProfile, inboxHistory, listInbox } from '@/lib/gmail';
import { emailDomain, isFreeMail, readRadarConfig, type RadarConfig } from '@/lib/radar';
import { addWorkdays } from '@/lib/radar-schedule';
import { REPLY_CATEGORIES, isValidCategory, readGmailMessage, returnDateFrom, screenMessage, stripQuoted, type ParsedMail, type ReplyCategory } from '@/lib/radar-reply';
import { fromZonedTime } from 'date-fns-tz';
import { deepSeekConfigured } from './deepseek-customer-service';
import { analyzeReply } from './radar-ai-service';
import { attachReplyToCustomer, pushReplyToBos } from './radar-bos-service';
import { pauseMailbox } from './radar-mailbox-service';
import { notifyAdmins } from './radar-notify-service';
import { stopSequence, strictReview } from './radar-queue-service';
import { restartWithNextEmail } from './radar-sender-service';
import { suppress } from './radar-suppression-service';

/**
 * Replies (docs/CUSTOMER_RADAR_COLD_EMAIL.md §7.2): every five minutes each sending mailbox's new inbox mail is read,
 * matched to the company it answers, pre-screened by rules (bounces, auto-replies), and the rest is read by DeepSeek.
 * Valid replies go into the customer center; invalid ones are handled here; anything uncertain waits in 待复核.
 */

const POLL_EVERY_MS = 5 * 60_000;
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'unknown').slice(0, 300);
const DAY = 24 * 3600_000;

type Match = { prospectId: string; sequenceId: string | null; sendId: string | null; matchedBy: 'THREAD' | 'HEADER' | 'ADDRESS' | 'DOMAIN' };
/**
 * Which company a message answers: the Gmail thread of a mail we sent, then the Message-IDs it replies to (a bounce
 * carries the original's), then the sender's address, then the sender's company domain. Unmatched mail is ignored.
 */
async function matchMessage(mail: ParsedMail, mailboxId: string, originalMessageId: string, bouncedTo: string): Promise<Match | null> {
  const viaSend = async (where: Prisma.RadarSendWhereInput, matchedBy: Match['matchedBy']) => {
    const send = await db.radarSend.findFirst({ where: { ...where, status: { in: ['SENT', 'BOUNCED'] } }, orderBy: { sentAt: 'desc' } });
    return send ? { prospectId: send.prospectId, sequenceId: send.sequenceId, sendId: send.id, matchedBy } : null;
  };
  const byThread = mail.threadId ? await viaSend({ threadId: mail.threadId, mailboxId }, 'THREAD') : null;
  if (byThread) return byThread;
  const ids = [...new Set([mail.inReplyTo, ...mail.references, originalMessageId].filter(Boolean))];
  const byHeader = ids.length ? await viaSend({ messageId: { in: ids } }, 'HEADER') : null;
  if (byHeader) return byHeader;
  const from = bouncedTo || mail.from;
  const latest = async (prospectId: string, matchedBy: Match['matchedBy']) => {
    const send = await db.radarSend.findFirst({ where: { prospectId, status: { in: ['SENT', 'BOUNCED'] } }, orderBy: { sentAt: 'desc' } });
    return { prospectId, sequenceId: send?.sequenceId ?? null, sendId: send?.id ?? null, matchedBy };
  };
  const email = from ? await db.radarEmail.findFirst({ where: { address: from }, orderBy: { createdAt: 'desc' } }) : null;
  if (email) return latest(email.prospectId, 'ADDRESS');
  const domain = from ? emailDomain(from) : '';
  if (domain && !isFreeMail(domain)) {
    const prospect = await db.radarProspect.findFirst({ where: { domain, sends: { some: { status: { in: ['SENT', 'BOUNCED'] } } } }, orderBy: { updatedAt: 'desc' } });
    if (prospect) return latest(prospect.id, 'DOMAIN');
  }
  return null;
}

/** Reads one mailbox's new inbox mail and stores what matches a radar company. */
async function pollMailbox(box: { id: string; address: string; credential: string | null; historyId: string | null }, now: Date) {
  const token = await accessToken(openSecret(box.credential ?? ''));
  let ids: string[] = [], historyId = box.historyId;
  if (!historyId) historyId = (await gmailProfile(token)).historyId;
  else {
    try { ({ ids, historyId } = await inboxHistory(token, historyId)); }
    catch (error) {
      // A history id older than about a week is gone: read the last three days instead and start again from now.
      if (!(error instanceof GmailError && error.status === 404)) throw error;
      ids = await listInbox(token, 'newer_than:3d');
      historyId = (await gmailProfile(token)).historyId;
    }
  }
  let stored = 0;
  for (const id of ids.slice(0, 200)) {
    if (await db.radarReply.findUnique({ where: { mailboxId_providerMessageId: { mailboxId: box.id, providerMessageId: id } } })) continue;
    const mail = readGmailMessage(await getMessage(token, id, 'full'));
    if (mail.from === box.address) continue;
    const screen = screenMessage(mail);
    const match = await matchMessage(mail, box.id, screen.originalMessageId, screen.recipient);
    if (!match) continue;
    try {
      await db.radarReply.create({ data: {
        mailboxId: box.id, providerMessageId: id, threadId: mail.threadId, messageId: mail.messageId.slice(0, 255), prospectId: match.prospectId, sequenceId: match.sequenceId, sendId: match.sendId,
        matchedBy: match.matchedBy, fromAddress: (mail.from || 'unknown').slice(0, 191), fromName: mail.fromName.slice(0, 191), subject: mail.subject.slice(0, 300),
        receivedAt: mail.date ?? now, rawText: `${mail.text}\n${mail.report}`.slice(0, 200_000), text: (screen.screen === 'NONE' ? stripQuoted(mail.text) : mail.text).slice(0, 20_000),
        screen: screen.screen, ...(screen.screen !== 'NONE' ? { category: screen.screen === 'AUTO_REPLY' ? 'AUTO_REPLY' : 'BOUNCE', aiCategory: '', valid: false, summary: screen.detail.slice(0, 500) } : {}),
      } });
      stored++;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }
  await db.radarMailbox.update({ where: { id: box.id }, data: { historyId, lastPolledAt: now } });
  return stored;
}

/** Every connected mailbox not read in the last five minutes. A revoked authorisation pauses the mailbox. */
export async function pollInboxes(now = new Date()) {
  const boxes = await db.radarMailbox.findMany({ where: { credential: { not: null }, OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(now.getTime() - POLL_EVERY_MS + 30_000) } }] } });
  let stored = 0, failed = 0;
  for (const box of boxes) {
    try { stored += await pollMailbox(box, now); }
    catch (error) {
      failed++;
      if (error instanceof GmailError && error.kind === 'AUTH' && await pauseMailbox(box.id, '授权失效，请在设置里重新连接这个邮箱')) {
        await notifyAdmins(`客户雷达：发信邮箱 ${box.address} 已暂停`, '读取收件箱时授权失效，请在设置里重新连接', '/settings/radar', `radar-mailbox-${box.id}`);
      }
      console.warn('[radar] inbox poll failed', { mailbox: box.address, error: errorText(error) });
    }
  }
  return { mailboxes: boxes.length, stored, failed };
}

// ─── Handling ───────────────────────────────────────────

type ReplyRow = Prisma.RadarReplyGetPayload<{ include: { prospect: true; sequence: true; send: true; mailbox: true } }>;
async function radarConfig() {
  const s = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true, radarLaunchedAt: true } });
  return { config: readRadarConfig(s.radarConfig), launchedAt: s.radarLaunchedAt };
}

/** Out of office: the sequence waits until two working days after the person is back (five working days if unknown). */
async function pauseForAutoReply(tx: Prisma.TransactionClient, reply: ReplyRow, config: RadarConfig, returnDate: Date | null) {
  if (!reply.sequence || !['ACTIVE', 'PAUSED'].includes(reply.sequence.status)) return;
  const country = config.countries[reply.prospect.country];
  if (!country) return;
  const base = returnDate ? fromZonedTime(`${returnDate.toISOString().slice(0, 10)}T12:00:00`, reply.prospect.timezone) : reply.receivedAt;
  const resumeAt = addWorkdays(base, returnDate ? 2 : 5, country, reply.prospect.timezone);
  await tx.radarSequence.update({ where: { id: reply.sequence.id }, data: { status: 'PAUSED', resumeAt } });
  const waiting = await tx.radarSend.findMany({ where: { sequenceId: reply.sequence.id, status: { in: ['PREPARING', 'REVIEW', 'QUEUED'] } }, select: { id: true, dueAt: true } });
  for (const s of waiting) if (s.dueAt < resumeAt) await tx.radarSend.update({ where: { id: s.id }, data: { dueAt: resumeAt } });
}

/** A mailbox with more bounces than allowed among its last mails is paused before it hurts the domain. */
async function checkBounceRate(mailboxId: string, config: RadarConfig) {
  const recent = await db.radarSend.findMany({ where: { mailboxId, status: { in: ['SENT', 'BOUNCED'] } }, orderBy: { sentAt: 'desc' }, take: config.bounceWindow, select: { status: true } });
  const bounced = recent.filter(r => r.status === 'BOUNCED').length;
  if (bounced <= config.maxBouncesInWindow) return;
  const box = await db.radarMailbox.findUniqueOrThrow({ where: { id: mailboxId } });
  const reason = `最近 ${recent.length} 封里退信 ${bounced} 封，超过 ${config.maxBouncesInWindow} 封`;
  if (await pauseMailbox(mailboxId, reason)) await notifyAdmins(`客户雷达：发信邮箱 ${box.address} 已暂停`, reason, '/settings/radar', `radar-mailbox-${mailboxId}`);
}

/** Rule-screened bounces: a permanent one blocks the address and moves the company to its next one; a temporary one resends once in three days. */
async function handleBounce(reply: ReplyRow, config: RadarConfig) {
  const send = reply.send;
  if (!send) return;
  const soft = reply.screen === 'SOFT_BOUNCE' && !send.lastError.startsWith('软退信');
  await retryTransaction(() => db.$transaction(async tx => {
    if (soft) {
      await tx.radarSend.update({ where: { id: send.id }, data: { status: 'QUEUED', dueAt: new Date(reply.receivedAt.getTime() + 3 * DAY), lastError: `软退信，3 天后重发：${reply.summary}`.slice(0, 500) } });
      return;
    }
    await tx.radarSend.update({ where: { id: send.id }, data: { status: 'BOUNCED', lastError: `退信：${reply.summary}`.slice(0, 500) } });
    await tx.radarEmail.update({ where: { id: send.emailId }, data: { bouncedAt: reply.receivedAt } });
    await suppress(tx, { scope: 'EMAIL', value: send.toAddress, reason: 'HARD_BOUNCE', note: reply.summary });
    if (reply.sequence && ['ACTIVE', 'PAUSED'].includes(reply.sequence.status)) await restartWithNextEmail(tx, reply.sequence.id, 'BOUNCE');
  }));
  if (!soft && send.mailboxId) await checkBounceRate(send.mailboxId, config);
}

const PROSPECT_AFTER: Partial<Record<ReplyCategory, string>> = { NOT_INTERESTED: 'NOT_INTERESTED', UNSUBSCRIBE: 'UNSUBSCRIBED', UNRELATED: 'EXCLUDED' };
/**
 * What a decided reply does. Any human reply ends the sequence ("客户一回复就停"); an auto-reply only pauses it.
 * Valid replies go to the customer center (or wait for a person while `review`), the others are handled here.
 */
async function applyDecision(reply: ReplyRow, category: ReplyCategory, config: RadarConfig, review: boolean) {
  if (category === 'BOUNCE') { await handleBounce({ ...reply, screen: reply.screen === 'SOFT_BOUNCE' ? 'SOFT_BOUNCE' : 'HARD_BOUNCE' }, config); return 'BOUNCE'; }
  await retryTransaction(() => db.$transaction(async tx => {
    if (category === 'AUTO_REPLY') { await pauseForAutoReply(tx, reply, config, reply.returnDate); return; }
    if (reply.sequence && ['ACTIVE', 'PAUSED'].includes(reply.sequence.status)) await stopSequence(tx, reply.sequence.id, 'REPLIED', category, 'REPLIED');
    if (review) { await tx.radarProspect.update({ where: { id: reply.prospectId }, data: { status: 'REVIEW', statusAt: new Date() } }); return; }
    if (isValidCategory(category)) { await tx.radarReply.update({ where: { id: reply.id }, data: { pushStatus: 'PENDING' } }); return; }
    const domain = reply.prospect.domain || (!isFreeMail(emailDomain(reply.fromAddress)) ? emailDomain(reply.fromAddress) : '');
    if (category === 'NOT_INTERESTED') await suppress(tx, { scope: domain ? 'DOMAIN' : 'EMAIL', value: domain || reply.fromAddress, reason: 'NOT_INTERESTED', days: config.notInterestedCooldownDays });
    if (category === 'UNSUBSCRIBE') {
      await suppress(tx, { scope: 'EMAIL', value: reply.fromAddress, reason: 'UNSUBSCRIBE', note: '对方要求不再联系' });
      if (reply.send && reply.send.toAddress !== reply.fromAddress) await suppress(tx, { scope: 'EMAIL', value: reply.send.toAddress, reason: 'UNSUBSCRIBE', note: '对方要求不再联系' });
    }
    if (category === 'UNRELATED' && domain) await suppress(tx, { scope: 'DOMAIN', value: domain, reason: 'UNRELATED' });
    const status = PROSPECT_AFTER[category] ?? 'NO_REPLY';
    await tx.radarProspect.update({ where: { id: reply.prospectId }, data: { status, statusAt: new Date(), ...(category === 'UNRELATED' ? { excludedReason: '回复为无关内容或推销' } : {}) } });
  }));
  if (!review && isValidCategory(category)) {
    try { await pushReplyToBos(reply.id); }
    catch (error) { await pushFailed(reply.id, error); }
  }
  return category;
}

async function pushFailed(replyId: string, error: unknown) {
  const r = await db.radarReply.update({ where: { id: replyId }, data: { pushStatus: 'FAILED', pushAttempts: { increment: 1 }, pushError: errorText(error) } });
  console.warn('[radar] push to BOS failed', { replyId, error: errorText(error) });
  if (r.pushAttempts === 3) await notifyAdmins('客户雷达：有效回复推进 BOS 失败', `${r.fromAddress}：${errorText(error)}。回复保留在雷达里，请在待复核里重试`, '/radar/review?tab=replies', `radar-push-${replyId}`);
}

/**
 * Handles stored replies not handled yet: rule-screened ones directly, the rest after DeepSeek. Without DeepSeek, an
 * unreadable answer, a low confidence or an unclear reply, the reply waits in 待复核; in the first two weeks valid
 * replies wait there too.
 */
export async function processReplies(limit = 10, now = new Date()) {
  const { config, launchedAt } = await radarConfig();
  const rows = await db.radarReply.findMany({ where: { processedAt: null, analyzeAttempts: { lt: 3 } }, include: { prospect: true, sequence: true, send: true, mailbox: true },
    orderBy: { receivedAt: 'asc' }, take: limit });
  const result = { processed: 0, toBos: 0, review: 0, attached: 0 };
  for (const reply of rows) {
    const claim = await db.radarReply.updateMany({ where: { id: reply.id, processedAt: null, analyzeAttempts: reply.analyzeAttempts }, data: { analyzeAttempts: { increment: 1 } } });
    if (!claim.count) continue;
    // A company already in the customer center: its mail goes straight under the customer.
    if (reply.prospect.customerId && reply.screen === 'NONE') {
      await attachReplyToCustomer(reply.id);
      await db.radarReply.update({ where: { id: reply.id }, data: { processedAt: now } });
      result.attached++; result.processed++;
      continue;
    }
    if (reply.screen !== 'NONE') {
      const returnDate = reply.screen === 'AUTO_REPLY' ? returnDateFrom(reply.text, reply.receivedAt) : null;
      if (returnDate) await db.radarReply.update({ where: { id: reply.id }, data: { returnDate } });
      await applyDecision({ ...reply, returnDate }, reply.screen === 'AUTO_REPLY' ? 'AUTO_REPLY' : 'BOUNCE', config, false);
      await db.radarReply.update({ where: { id: reply.id }, data: { processedAt: now } });
      result.processed++;
      continue;
    }
    let category: ReplyCategory = 'UNCLEAR', review = true;
    if (deepSeekConfigured()) {
      try {
        const ourMail = reply.send ? { subject: reply.send.subject, body: reply.send.body, step: reply.send.step } : { subject: '', body: '', step: 0 };
        const { analysis, raw } = await analyzeReply({ reply: { from: reply.fromAddress, subject: reply.subject, text: reply.text }, ourMail, company: reply.prospect.name, country: reply.prospect.country });
        category = analysis.category;
        const valid = isValidCategory(category);
        review = category === 'UNCLEAR' || analysis.confidence < config.reviewConfidence || (valid && strictReview(launchedAt, config, now));
        const returnDate = analysis.returnDate ? new Date(`${analysis.returnDate}T00:00:00Z`) : category === 'AUTO_REPLY' ? returnDateFrom(reply.text, reply.receivedAt) : null;
        await db.radarReply.update({ where: { id: reply.id }, data: { aiCategory: category, category, valid, confidence: analysis.confidence, summary: analysis.summary,
          intent: analysis.intent, extracted: analysis.extracted, returnDate, complaint: analysis.complaint, aiRaw: raw as Prisma.InputJsonValue, analyzedAt: now, analyzeError: '',
          reviewStatus: review ? 'PENDING' : 'NONE' } });
        if (analysis.complaint && reply.send?.mailboxId && await pauseMailbox(reply.send.mailboxId, `收到投诉：${reply.fromAddress}`)) {
          await notifyAdmins(`客户雷达：收到投诉，发信邮箱 ${reply.mailbox.address} 已暂停`, `${reply.fromAddress}：${analysis.summary}`, '/radar/review?tab=replies', `radar-complaint-${reply.id}`);
        }
        Object.assign(reply, { returnDate, category, summary: analysis.summary, extracted: analysis.extracted, intent: analysis.intent });
      } catch (error) {
        // Not readable this time: try again next run, and after three tries a person decides.
        await db.radarReply.update({ where: { id: reply.id }, data: { analyzeError: errorText(error) } });
        // Until it is read, the sender sends nothing more to this company (an unhandled reply holds the company).
        if (reply.analyzeAttempts + 1 < 3) continue;
        await db.radarReply.update({ where: { id: reply.id }, data: { category: 'UNCLEAR', reviewStatus: 'PENDING' } });
      }
    } else {
      await db.radarReply.update({ where: { id: reply.id }, data: { category: 'UNCLEAR', reviewStatus: 'PENDING', analyzeError: '尚未配置 DEEPSEEK_API_KEY' } });
    }
    await applyDecision(reply, category, config, review);
    await db.radarReply.update({ where: { id: reply.id }, data: { processedAt: now } });
    result.processed++;
    if (review) result.review++; else if (isValidCategory(category)) result.toBos++;
  }
  if (result.review) await notifyAdmins('客户雷达：有回复等人工复核', `${result.review} 封回复 AI 拿不准或需要确认`, '/radar/review?tab=replies', `radar-review-${now.getTime()}`);
  return result;
}

/** Pushes that failed earlier, again (three tries in all). */
export async function retryPushes() {
  const rows = await db.radarReply.findMany({ where: { pushStatus: { in: ['PENDING', 'FAILED'] }, pushAttempts: { lt: 3 }, reviewStatus: { not: 'PENDING' } }, select: { id: true }, take: 20 });
  let pushed = 0;
  for (const r of rows) {
    try { await pushReplyToBos(r.id); pushed++; } catch (error) { await pushFailed(r.id, error); }
  }
  return { pushed };
}

// ─── 待复核 · 回复 ─────────────────────────────────────

export async function reviewReplies(user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  const rows = await db.radarReply.findMany({ where: { OR: [{ reviewStatus: 'PENDING' }, { pushStatus: 'FAILED' }] },
    include: { prospect: { select: { id: true, name: true, country: true, city: true, website: true } }, send: { select: { templateCode: true, step: true, subject: true } } }, orderBy: { receivedAt: 'asc' }, take: 200 });
  return rows.map(r => ({ id: r.id, receivedAt: r.receivedAt, fromAddress: r.fromAddress, fromName: r.fromName, subject: r.subject, text: r.text, summary: r.summary,
    aiCategory: r.aiCategory, category: r.category, categoryLabel: REPLY_CATEGORIES[r.category as ReplyCategory] ?? '', confidence: r.confidence === null ? null : Number(r.confidence),
    intent: r.intent, extracted: r.extracted as Record<string, string> | null, analyzeError: r.analyzeError, reviewStatus: r.reviewStatus, pushStatus: r.pushStatus, pushError: r.pushError,
    prospect: r.prospect, send: r.send }));
}

const decision = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('VALID'), category: z.enum(['QUOTE', 'INTERESTED', 'QUESTION', 'REFERRAL']).optional(), note: z.string().trim().max(300).default('') }),
  z.object({ verdict: z.literal('INVALID'), category: z.enum(['NOT_INTERESTED', 'UNSUBSCRIBE', 'AUTO_REPLY', 'BOUNCE', 'UNRELATED'], { errorMap: () => ({ message: '请选择无效回复的分类' }) }), note: z.string().trim().max(300).default('') }),
  z.object({ verdict: z.literal('RETRY_PUSH') }),
], { errorMap: () => ({ message: '请选择有效或无效' }) });

/**
 * A person decides a reply: 有效 pushes it into the customer center, 无效 with a category is handled as that category.
 * The AI's answer stays recorded next to the decision, for checking the prompt.
 */
export async function decideReply(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以使用客户雷达');
  z.string().trim().min(1).max(191).parse(id);
  const v = decision.parse(input);
  const reply = await db.radarReply.findUnique({ where: { id }, include: { prospect: true, sequence: true, send: true, mailbox: true } });
  if (!reply) throw new HttpError(404, '回复不存在');
  if (v.verdict === 'RETRY_PUSH') {
    if (reply.pushStatus !== 'FAILED') throw new HttpError(409, '这封回复不需要重新推送');
    await db.radarReply.update({ where: { id }, data: { pushAttempts: 0 } });
    try { return { id, ...(await pushReplyToBos(id)) }; } catch (error) { await pushFailed(id, error); throw new HttpError(502, `推进 BOS 失败：${errorText(error)}`); }
  }
  if (reply.reviewStatus !== 'PENDING') throw new HttpError(409, '这封回复已经处理过了');
  const category: ReplyCategory = v.verdict === 'VALID' ? (v.category ?? (isValidCategory(reply.category) ? reply.category as ReplyCategory : 'INTERESTED')) : v.category;
  const changed = await db.radarReply.updateMany({ where: { id, reviewStatus: 'PENDING' }, data: {
    category, valid: v.verdict === 'VALID', reviewStatus: category === reply.aiCategory ? 'CONFIRMED' : 'CORRECTED', reviewedById: user.id, reviewedAt: new Date(), reviewNote: v.note } });
  if (!changed.count) throw new HttpError(409, '这封回复刚刚被处理了，请刷新');
  const { config } = await radarConfig();
  const returnDate = category === 'AUTO_REPLY' ? reply.returnDate ?? returnDateFrom(reply.text, reply.receivedAt) : null;
  const screen = category === 'BOUNCE' ? 'HARD_BOUNCE' : reply.screen;
  // Held for review, the sequence already stopped. Read as an auto-reply after all, the company simply goes back on the
  // wall to be queued again by hand; the stopped sequence is not revived.
  if (category === 'AUTO_REPLY' && reply.sequence?.status === 'REPLIED') {
    await db.radarProspect.updateMany({ where: { id: reply.prospectId, status: 'REVIEW' }, data: { status: 'NEW', statusAt: new Date() } });
    return { id, category };
  }
  await applyDecision({ ...reply, screen, returnDate, category }, category, config, false);
  return { id, category };
}

// ─── Sequences over time ────────────────────────────────

/**
 * Moves sequences on with time: an auto-reply pause ends at its date; a sequence whose last mail went out `endDays`
 * ago with nothing left to send ends without reply, and the company rests for the no-reply cooldown.
 */
export async function sweepSequences(now = new Date()) {
  const { config } = await radarConfig();
  const resumed = await db.radarSequence.updateMany({ where: { status: 'PAUSED', resumeAt: { lte: now } }, data: { status: 'ACTIVE', resumeAt: null } });
  const candidates = await db.radarSequence.findMany({ where: { status: 'ACTIVE', sends: { none: { status: { in: ['PREPARING', 'REVIEW', 'QUEUED', 'SENDING', 'UNKNOWN'] } } } },
    include: { sends: { where: { status: 'SENT' }, orderBy: { sentAt: 'desc' }, take: 1 }, prospect: { select: { id: true, domain: true } }, email: { select: { address: true } } }, take: 200 });
  let ended = 0;
  for (const s of candidates) {
    const last = s.sends[0];
    if (!last?.sentAt || now.getTime() - last.sentAt.getTime() < config.endDays * DAY) continue;
    await retryTransaction(() => db.$transaction(async tx => {
      const fresh = await tx.radarSequence.findUniqueOrThrow({ where: { id: s.id } });
      if (fresh.status !== 'ACTIVE') return;
      await stopSequence(tx, s.id, 'ENDED', 'NO_REPLY', 'SEQUENCE_STOPPED');
      await suppress(tx, { scope: s.prospect.domain ? 'DOMAIN' : 'EMAIL', value: s.prospect.domain || s.email.address, reason: 'NO_REPLY', days: config.noReplyCooldownDays });
      await tx.radarProspect.updateMany({ where: { id: s.prospectId, status: { in: ['QUEUED', 'IN_SEQUENCE'] } }, data: { status: 'NO_REPLY', statusAt: now } });
      ended++;
    }));
  }
  return { resumed: resumed.count, ended };
}
