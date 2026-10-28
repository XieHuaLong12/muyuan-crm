import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { openSecret } from '@/lib/secret';
import { GmailError, accessToken, getMessage, headerOf, sendMessage } from '@/lib/gmail';
import { rankEmails, sendable, type RadarConfig } from '@/lib/radar';
import { DAY_MS, addWorkdays, nextCapLevel, pickNext, randomGap, type QueueItem } from '@/lib/radar-schedule';
import { buildMessage, greetingFor, mailBody, renderTemplate, replySubject, type MailLanguage } from '@/lib/radar-mail';
import { retryTransaction } from '@/lib/transaction-retry';
import { findBosCustomer } from './radar-bos-service';
import { mailboxStates, pauseMailbox } from './radar-mailbox-service';
import { notifyAdmins } from './radar-notify-service';
import { lockKey, prepareOpenings, stopSequence } from './radar-queue-service';
import { suppress, suppressionFor } from './radar-suppression-service';
import { pickTemplate } from './radar-template-service';

/**
 * The radar's sender (docs/CUSTOMER_RADAR_COLD_EMAIL.md §7.1), run every minute by /api/cron/radar. Each mailbox sends
 * at most one mail per run, and only after its random gap; a mail leaves only inside the recipient's working hours
 * and after a last check that it should still go. Nothing is sent unless RADAR_SEND_ENABLED=true, so a development
 * copy or a database copy never mails a real company.
 */

const STUCK_MS = 10 * 60_000;
const RETRY_MINUTES = [5, 15, 45];
export const sendingEnabled = () => process.env.RADAR_SEND_ENABLED === 'true';
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'unknown').slice(0, 500);

/**
 * A mail claimed for sending more than ten minutes ago never reported back: the process may have died after Gmail
 * accepted it. It is never sent again automatically — a person checks the sent folder (发送队列 · 状态不明).
 */
async function recoverStuck(now: Date) {
  const stuck = await db.radarSend.findMany({ where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - STUCK_MS) } }, select: { id: true, toAddress: true } });
  for (const s of stuck) {
    const changed = await db.radarSend.updateMany({ where: { id: s.id, status: 'SENDING' }, data: { status: 'UNKNOWN', lastError: '发送过程中断，不确定是否已发出，请到发信邮箱的「已发送」里核对' } });
    if (changed.count) await notifyAdmins('客户雷达：有一封信发送状态不明', `${s.toAddress}：请到发信邮箱的「已发送」里核对后，在发送队列里确认`, '/radar/queue?view=PROBLEM', `radar-unknown-${s.id}`);
  }
  return stuck.length;
}

/** Moves each mailbox's warm-up up one level a week while its last week was clean. */
async function rampMailboxes(now: Date) {
  const { boxes, config } = await mailboxStates(now);
  for (const { box } of boxes) {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const [sent, bounced] = await Promise.all([
      db.radarSend.count({ where: { mailboxId: box.id, status: { in: ['SENT', 'BOUNCED'] }, sentAt: { gte: weekAgo } } }),
      db.radarSend.count({ where: { mailboxId: box.id, status: 'BOUNCED', sentAt: { gte: weekAgo } } }),
    ]);
    const clean = (sent === 0 || bounced / sent < config.maxBouncesInWindow / config.bounceWindow) && !(box.status === 'PAUSED' && box.pausedAt && box.pausedAt > weekAgo);
    const level = nextCapLevel(box, config.rampLevels, now, clean);
    if (level !== box.capLevel) await db.radarMailbox.updateMany({ where: { id: box.id, capLevel: box.capLevel }, data: { capLevel: level, rampedAt: now } });
  }
}

type Claimed = Prisma.RadarSendGetPayload<{ include: { prospect: true; sequence: true; email: true } }>;
type Box = Awaited<ReturnType<typeof mailboxStates>>['boxes'][number]['box'];

/** Why this mail must not go now, or null. Runs right before sending: much can change between the click and the slot. */
async function blocker(send: Claimed): Promise<{ cancel: 'SUPPRESSED' | 'IN_BOS' | 'SEQUENCE_STOPPED' | 'ADDRESS_INVALID' | 'REPLIED'; note: string } | null> {
  if (send.sequence.status !== 'ACTIVE') return { cancel: 'SEQUENCE_STOPPED', note: send.sequence.endReason };
  if (send.email.bouncedAt || send.email.verifyStatus === 'INVALID') return { cancel: 'ADDRESS_INVALID', note: send.toAddress };
  const blocked = await suppressionFor(db, send.toAddress, [send.prospect.domain].filter(Boolean));
  if (blocked) return { cancel: 'SUPPRESSED', note: blocked.reason };
  const customer = await findBosCustomer({ emails: [send.toAddress], phones: [send.prospect.phoneE164, send.prospect.whatsapp].filter((x): x is string => !!x), domain: send.prospect.domain });
  if (customer) return { cancel: 'IN_BOS', note: customer.companyName || customer.name };
  return null;
}

async function cancelClaimed(send: Claimed, why: NonNullable<Awaited<ReturnType<typeof blocker>>>) {
  await retryTransaction(() => db.$transaction(async tx => {
    await tx.radarSend.update({ where: { id: send.id }, data: { status: 'CANCELLED', cancelReason: why.cancel, lastError: why.note.slice(0, 500) } });
    // An address found invalid since the click: the company may have another one.
    if (why.cancel === 'ADDRESS_INVALID') { await restartWithNextEmail(tx, send.sequenceId, 'ADDRESS_INVALID'); return; }
    if (send.sequence.status === 'ACTIVE' || send.sequence.status === 'PAUSED') await stopSequence(tx, send.sequenceId, 'STOPPED', why.cancel, why.cancel);
    if (why.cancel === 'IN_BOS') {
      if (send.prospect.domain) await suppress(tx, { scope: 'DOMAIN', value: send.prospect.domain, reason: 'CUSTOMER', note: why.note });
      await tx.radarProspect.update({ where: { id: send.prospectId }, data: { status: 'EXCLUDED', statusAt: new Date(), excludedReason: `已在 BOS：${why.note}`.slice(0, 200) } });
    } else if (why.cancel === 'SUPPRESSED') {
      await tx.radarProspect.updateMany({ where: { id: send.prospectId, status: { in: ['QUEUED', 'IN_SEQUENCE'] } }, data: { status: send.step > 1 ? 'NO_REPLY' : 'EXCLUDED', statusAt: new Date(),
        ...(send.step > 1 ? {} : { excludedReason: `禁发名单：${why.note}`.slice(0, 200) }) } });
    }
  }));
}

/**
 * After an address proved undeliverable: the sequence ends, and when the company has another sendable address a new
 * sequence starts there from the first mail (the same 「加入发送队列」 authorised contacting this company). An
 * approved first mail keeps its approval; the words are the same.
 */
export async function restartWithNextEmail(tx: Prisma.TransactionClient, sequenceId: string, reason: string) {
  const sequence = await stopSequence(tx, sequenceId, 'BOUNCED', reason, 'SEQUENCE_STOPPED');
  const prospect = await tx.radarProspect.findUniqueOrThrow({ where: { id: sequence.prospectId }, include: { emails: true } });
  const tried = await tx.radarSequence.findMany({ where: { prospectId: prospect.id }, select: { emailId: true } });
  const next = rankEmails(prospect.emails.filter(e => sendable(e) && !tried.some(t => t.emailId === e.id)), prospect.domain)[0];
  const first = await tx.radarSend.findFirst({ where: { sequenceId, step: 1 } });
  if (!next || !first || await suppressionFor(tx, next.address, [prospect.domain].filter(Boolean))) {
    await tx.radarProspect.update({ where: { id: prospect.id }, data: { status: 'NO_EMAIL', statusAt: new Date() } });
    return null;
  }
  const restarted = await tx.radarSequence.create({ data: { prospectId: prospect.id, emailId: next.id, language: sequence.language, variant: sequence.variant,
    activeDomain: lockKey(prospect, next.address), needsReview: sequence.needsReview, enqueuedById: sequence.enqueuedById } });
  const approved = !!first.approvedAt || (first.openingSource !== 'AI' && !sequence.needsReview);
  await tx.radarSend.create({ data: {
    sequenceId: restarted.id, step: 1, prospectId: prospect.id, emailId: next.id, toAddress: next.address, templateId: first.templateId, templateCode: first.templateCode,
    subject: first.subject, body: first.body, opening: first.opening, openingSource: first.openingSource, edited: first.edited,
    status: approved ? 'QUEUED' : 'REVIEW', approvedById: first.approvedById, approvedAt: first.approvedAt,
    dueAt: new Date(), grade: first.grade, score: first.score, risky: next.verifyStatus === 'RISKY',
  } });
  await tx.radarProspect.update({ where: { id: prospect.id }, data: { status: 'QUEUED', statusAt: new Date() } });
  return restarted.id;
}

/**
 * The next mail of the sequence, queued as soon as this one went out: due the configured number of working days later
 * in the recipient's calendar, in the same thread. It never leaves if the company answers first — an unhandled reply
 * holds the company and a handled one stops the sequence. Follow-ups are fixed templates without an AI opening.
 */
async function queueFollowUp(tx: Prisma.TransactionClient, send: Claimed, sentAt: Date, config: RadarConfig) {
  const country = config.countries[send.prospect.country];
  const wait = config.followUpWorkdays[send.step - 1];
  if (send.step >= 3 || !country || !wait) return;
  const language = send.sequence.language as MailLanguage;
  const template = await pickTemplate(tx, language, send.step + 1, send.sequence.variant === 'FAIR' ? 'FAIR' : 'STANDARD');
  if (!template) return;
  const first = send.step === 1 ? send : await tx.radarSend.findFirst({ where: { sequenceId: send.sequenceId, step: 1 }, select: { subject: true } });
  const values = { greeting: greetingFor(language), company: send.prospect.name, city: send.prospect.city, opening: '', catalogUrl: config.catalogUrls[language] };
  await tx.radarSend.create({ data: {
    sequenceId: send.sequenceId, step: send.step + 1, prospectId: send.prospectId, emailId: send.emailId, toAddress: send.toAddress, templateId: template.id, templateCode: template.code,
    subject: replySubject(first?.subject ?? send.subject).slice(0, 300), body: renderTemplate(template.body, values), openingSource: 'NONE', status: 'QUEUED',
    dueAt: addWorkdays(sentAt, wait, country, send.prospect.timezone), grade: send.grade, score: send.score, risky: send.risky,
  } }).catch(error => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error; });
}

/** Sends one claimed mail through Gmail and records the outcome. Returns what happened. */
async function deliver(send: Claimed, box: Box, now: Date, config: RadarConfig): Promise<'SENT' | 'RETRY' | 'FAILED' | 'PAUSED'> {
  const maxFailures = config.maxConsecutiveFailures;
  let token: string;
  try { token = await accessToken(openSecret(box.credential ?? '')); }
  catch (error) { return mailboxProblem(send, box, error); }
  const thread = Array.isArray(send.sequence.messageIds) ? (send.sequence.messageIds as string[]) : [];
  const first = send.step > 1 ? await db.radarSend.findFirst({ where: { sequenceId: send.sequenceId, step: 1 }, select: { subject: true } }) : null;
  const mime = buildMessage({ from: { name: box.fromName, address: box.address }, to: send.toAddress,
    subject: first ? replySubject(first.subject) : send.subject, body: mailBody(send.body, box.signature, send.sequence.language as MailLanguage), thread, date: now });
  let sent: { id: string; threadId: string };
  try { sent = await sendMessage(token, mime, send.step > 1 ? send.sequence.threadId : null); }
  catch (error) { return mailboxProblem(send, box, error, maxFailures); }
  // The Message-ID Gmail gave the mail threads the follow-ups and matches replies; failing to read it is not a failure.
  const messageId = await getMessage(token, sent.id, 'metadata', ['Message-ID']).then(m => headerOf(m, 'Message-ID') || null).catch(() => null);
  await retryTransaction(() => db.$transaction(async tx => {
    await tx.radarSend.update({ where: { id: send.id }, data: { status: 'SENT', sentAt: now, providerMessageId: sent.id, threadId: sent.threadId, messageId, mailboxId: box.id, lastError: '' } });
    await tx.radarSequence.update({ where: { id: send.sequenceId }, data: { mailboxId: send.sequence.mailboxId ?? box.id, threadId: send.sequence.threadId ?? sent.threadId,
      messageIds: messageId ? [...thread, messageId] : thread } });
    if (send.templateId) await tx.radarTemplate.updateMany({ where: { id: send.templateId, firstSentAt: null }, data: { firstSentAt: now } });
    await tx.radarProspect.updateMany({ where: { id: send.prospectId, status: 'QUEUED' }, data: { status: 'IN_SEQUENCE', statusAt: now } });
    await tx.radarMailbox.update({ where: { id: box.id }, data: { consecutiveFailures: 0 } });
    await tx.setting.updateMany({ where: { id: 'system', radarLaunchedAt: null }, data: { radarLaunchedAt: now } });
    await queueFollowUp(tx, send, now, config);
  }));
  return 'SENT';
}

/**
 * What a Gmail error means: an expired authorisation or Gmail throttling pauses the mailbox and puts the mail back;
 * a temporary error retries the mail later (three times); a permanent one fails the mail, blocks the address and
 * moves the company to its next address. Repeated failures pause the mailbox too.
 */
async function mailboxProblem(send: Claimed, box: Box, error: unknown, maxFailures = 3): Promise<'RETRY' | 'FAILED' | 'PAUSED'> {
  const kind = error instanceof GmailError ? error.kind : 'TEMPORARY';
  const message = errorText(error);
  if (kind === 'AUTH' || kind === 'LIMIT') {
    await db.radarSend.update({ where: { id: send.id }, data: { status: 'QUEUED', mailboxId: null, lastError: message } });
    const reason = kind === 'AUTH' ? '授权失效，请在设置里重新连接这个邮箱' : `Gmail 提示发送受限：${message}`;
    if (await pauseMailbox(box.id, reason)) await notifyAdmins(`客户雷达：发信邮箱 ${box.address} 已暂停`, reason, '/settings/radar', `radar-mailbox-${box.id}`);
    return 'PAUSED';
  }
  const failures = (await db.radarMailbox.update({ where: { id: box.id }, data: { consecutiveFailures: { increment: 1 } } })).consecutiveFailures;
  if (failures >= maxFailures && await pauseMailbox(box.id, `连续 ${failures} 次发送失败：${message}`)) {
    await notifyAdmins(`客户雷达：发信邮箱 ${box.address} 已暂停`, `连续 ${failures} 次发送失败：${message}`, '/settings/radar', `radar-mailbox-${box.id}`);
  }
  if (kind === 'PERMANENT') {
    await retryTransaction(() => db.$transaction(async tx => {
      await tx.radarSend.update({ where: { id: send.id }, data: { status: 'FAILED', lastError: message, attempts: { increment: 1 } } });
      await tx.radarEmail.update({ where: { id: send.emailId }, data: { verifyStatus: 'INVALID', verifyDetail: message.slice(0, 200) } });
      await suppress(tx, { scope: 'EMAIL', value: send.toAddress, reason: 'HARD_BOUNCE', note: message });
      await restartWithNextEmail(tx, send.sequenceId, 'ADDRESS_INVALID');
    }));
    return 'FAILED';
  }
  const attempts = send.attempts + 1;
  if (attempts >= RETRY_MINUTES.length) {
    await db.radarSend.update({ where: { id: send.id }, data: { status: 'FAILED', attempts, lastError: message } });
    return 'FAILED';
  }
  await db.radarSend.update({ where: { id: send.id }, data: { status: 'QUEUED', attempts, mailboxId: null, lastError: message,
    nextAttemptAt: new Date(Date.now() + RETRY_MINUTES[attempts - 1] * 60_000) } });
  return 'RETRY';
}

/**
 * One run of the sender. Each mailbox whose gap has passed and whose daily cap is not reached takes the first eligible
 * mail in queue order; the mailbox's next slot and the mail are both claimed before sending, so overlapping runs
 * never send twice. A mail stopped by the last check is cancelled and does not use the day's cap.
 */
export async function runSender(now = new Date(), random = Math.random) {
  const result = { recovered: await recoverStuck(now), openings: await prepareOpenings(5), sent: 0, cancelled: 0, retried: 0, failed: 0, paused: 0, skipped: '' };
  await rampMailboxes(now);
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarPausedAt: true } });
  if (setting.radarPausedAt) return { ...result, skipped: 'PAUSED' };
  if (!sendingEnabled()) return { ...result, skipped: 'DISABLED' };
  const { boxes, config } = await mailboxStates(now);
  const ready = boxes.filter(b => b.connected && b.box.status === 'ACTIVE' && b.sentToday < b.cap && (!b.box.nextSendAt || b.box.nextSendAt <= now));
  if (!ready.length) return result;
  const waiting = await db.radarSend.findMany({
    where: { status: 'QUEUED', dueAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }], sequence: { status: 'ACTIVE' } },
    include: { prospect: { select: { timezone: true, country: true } }, sequence: { select: { mailboxId: true } } }, take: 1000,
  });
  // A reply not handled yet holds its company: no follow-up goes out before we know what the reply said.
  const held = new Set((await db.radarReply.findMany({ where: { processedAt: null, screen: 'NONE', prospectId: { in: waiting.map(w => w.prospectId) } }, select: { prospectId: true } })).map(r => r.prospectId));
  const items: QueueItem[] = waiting.filter(s => config.countries[s.prospect.country] && !held.has(s.prospectId)).map(s => ({
    id: s.id, step: s.step, dueAt: s.dueAt, pinnedAt: s.pinnedAt, grade: s.grade, score: s.score, createdAt: s.createdAt, risky: s.risky,
    timezone: s.prospect.timezone, country: config.countries[s.prospect.country], mailboxId: s.sequence.mailboxId,
  }));
  for (const state of ready) {
    const pick = pickNext(items, { id: state.box.id, riskyToday: state.riskyToday }, now, config.riskyPerMailboxPerDay);
    if (!pick) continue;
    items.splice(items.indexOf(pick), 1);
    const slot = await db.radarMailbox.updateMany({ where: { id: state.box.id, status: 'ACTIVE', OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }] },
      data: { nextSendAt: new Date(now.getTime() + randomGap(config, random)) } });
    if (!slot.count) continue;
    const claim = await db.radarSend.updateMany({ where: { id: pick.id, status: 'QUEUED' }, data: { status: 'SENDING', mailboxId: state.box.id } });
    if (!claim.count) { await db.radarMailbox.update({ where: { id: state.box.id }, data: { nextSendAt: now } }); continue; }
    const send = await db.radarSend.findUniqueOrThrow({ where: { id: pick.id }, include: { prospect: true, sequence: true, email: true } });
    const why = await blocker(send);
    if (why) {
      await cancelClaimed(send, why);
      // A cancelled mail does not use the mailbox's turn either.
      await db.radarMailbox.update({ where: { id: state.box.id }, data: { nextSendAt: now } });
      result.cancelled++;
      continue;
    }
    const outcome = await deliver(send, state.box, now, config);
    if (outcome === 'SENT') result.sent++; else if (outcome === 'RETRY') result.retried++; else if (outcome === 'FAILED') result.failed++; else result.paused++;
  }
  return result;
}
