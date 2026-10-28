import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { dayKey, localDate } from '@/lib/time';
import { safeEqual, sealSecret } from '@/lib/secret';
import { exchangeCode, gmailAuthUrl, gmailConfigured, gmailProfile } from '@/lib/gmail';
import { readRadarConfig } from '@/lib/radar';
import { DAY_MS, dailyCap, warmupWeek } from '@/lib/radar-schedule';

/**
 * 发信邮箱 (docs/CUSTOMER_RADAR_COLD_EMAIL.md §4.4): Google Workspace mailboxes connected with OAuth. The refresh
 * token is sealed with AUTH_SECRET and never leaves the server; only administrators connect or change mailboxes.
 */

const STATE_TTL_MS = 15 * 60_000;
const sign = (payload: string) => {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET 未配置');
  return createHmac('sha256', process.env.AUTH_SECRET).update(`radar-mailbox|${payload}`).digest('base64url');
};
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '预热开始日期格式为 yyyy-MM-dd');

/** Google's consent page for connecting a mailbox. `state` binds the answer to this administrator and warm-up date. */
export async function mailboxConnectUrl(user: Actor, query: { warmup?: string }, origin: string) {
  requireAdmin(user, '只有管理员可以连接发信邮箱');
  if (!gmailConfigured()) throw new HttpError(503, '尚未配置 GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET');
  const warmup = day.parse(query.warmup ?? dayKey(new Date()));
  const payload = `${user.id}.${Date.now() + STATE_TTL_MS}.${warmup}`;
  return gmailAuthUrl(`${payload}.${sign(payload)}`, callbackUrl(origin));
}
export const callbackUrl = (origin: string) => `${(process.env.PUBLIC_APP_URL?.trim() || origin).replace(/\/$/, '')}/api/radar/mailboxes/callback`;

/**
 * Google's answer: checks the state, trades the code for tokens, reads which address was connected and stores it.
 * Reconnecting an address keeps its warm-up and history; only the token is replaced and a pause for an expired
 * authorisation is lifted.
 */
export async function connectMailbox(user: Actor, query: { code?: string; state?: string; error?: string }, origin: string) {
  requireAdmin(user, '只有管理员可以连接发信邮箱');
  if (query.error) throw new HttpError(400, query.error === 'access_denied' ? '已取消授权' : `Google 授权失败：${query.error}`.slice(0, 200));
  const parts = (query.state ?? '').split('.');
  if (parts.length !== 4 || !query.code) throw new HttpError(400, '授权链接无效，请重新连接');
  const [userId, expires, warmup, signature] = parts;
  const payload = `${userId}.${expires}.${warmup}`;
  if (!safeEqual(signature, sign(payload)) || userId !== user.id || Number(expires) < Date.now()) throw new HttpError(400, '授权已过期或不是本人发起，请重新连接');
  const tokens = await exchangeCode(query.code, callbackUrl(origin));
  const profile = await gmailProfile(tokens.accessToken);
  const address = profile.emailAddress.trim().toLowerCase();
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const warmupStartedAt = localDate(`${warmup}T00:00:00`, timezone);
  const credential = sealSecret(tokens.refreshToken);
  const existing = await db.radarMailbox.findUnique({ where: { address } });
  if (existing) {
    await db.radarMailbox.update({ where: { id: existing.id }, data: { credential, historyId: existing.historyId ?? profile.historyId,
      ...(existing.status === 'PAUSED' && existing.pausedReason.startsWith('授权') ? { status: 'ACTIVE', pausedReason: '', pausedAt: null, consecutiveFailures: 0 } : {}) } });
    return { address, created: false };
  }
  const config = readRadarConfig((await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } })).radarConfig);
  // A mailbox that has been warming up elsewhere starts at the level its weeks earned.
  const level = Math.min(warmupWeek(warmupStartedAt, new Date()), config.rampLevels.length - 1);
  await db.radarMailbox.create({ data: { address, domain: address.split('@')[1], credential, warmupStartedAt, capLevel: level,
    rampedAt: new Date(warmupStartedAt.getTime() + level * 7 * DAY_MS), historyId: profile.historyId, fromName: address.split('@')[0].replace(/^./, c => c.toUpperCase()) } });
  return { address, created: true };
}

const patchInput = z.object({
  fromName: z.string().trim().max(80, '显示名最多 80 字').optional(),
  signature: z.string().trim().max(1000, '签名最多 1000 字').optional(),
  warmupStartedAt: day.optional(),
  capOverride: z.coerce.number().int().min(0).max(500).nullable().optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
});

/** Name, signature, warm-up date, a lower cap by hand, pause and resume (resuming clears the failure count). */
export async function updateMailbox(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以修改发信邮箱');
  z.string().trim().min(1).max(191).parse(id);
  const v = patchInput.parse(input);
  const box = await db.radarMailbox.findUnique({ where: { id } });
  if (!box) throw new HttpError(404, '发信邮箱不存在');
  if (v.status === 'ACTIVE' && !box.credential) throw new HttpError(409, '这个邮箱的授权已失效，请先重新连接');
  let warm = {};
  if (v.warmupStartedAt) {
    const { timezone, radarConfig } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, radarConfig: true } });
    const start = localDate(`${v.warmupStartedAt}T00:00:00`, timezone);
    const level = Math.min(warmupWeek(start, new Date()), readRadarConfig(radarConfig).rampLevels.length - 1);
    warm = { warmupStartedAt: start, capLevel: level, rampedAt: new Date(start.getTime() + level * 7 * DAY_MS) };
  }
  await db.radarMailbox.update({ where: { id }, data: {
    ...(v.fromName !== undefined ? { fromName: v.fromName } : {}), ...(v.signature !== undefined ? { signature: v.signature } : {}),
    ...(v.capOverride !== undefined ? { capOverride: v.capOverride } : {}), ...warm,
    ...(v.status === 'PAUSED' && box.status !== 'PAUSED' ? { status: 'PAUSED', pausedReason: '手动暂停', pausedAt: new Date() } : {}),
    ...(v.status === 'ACTIVE' && box.status !== 'ACTIVE' ? { status: 'ACTIVE', pausedReason: '', pausedAt: null, consecutiveFailures: 0 } : {}),
  } });
  return { id };
}

/** Pauses a mailbox and says why; the sender skips it until someone resumes it. */
export async function pauseMailbox(id: string, reason: string) {
  const changed = await db.radarMailbox.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'PAUSED', pausedReason: reason.slice(0, 300), pausedAt: new Date() } });
  return changed.count > 0;
}

export async function todayStart(now = new Date()) {
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  return { start: localDate(`${dayKey(now, timezone)}T00:00:00`, timezone), timezone };
}

/**
 * Each mailbox with today's cap and what it already sent today (in the company's day). A mail being sent or of
 * unknown outcome counts as sent; a bounce or a cancelled mail does not use the day's cap.
 */
export async function mailboxStates(now = new Date()) {
  const [{ start, timezone }, setting, boxes] = await Promise.all([
    todayStart(now),
    db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } }),
    db.radarMailbox.findMany({ orderBy: { address: 'asc' } }),
  ]);
  const config = readRadarConfig(setting.radarConfig);
  const counted = { OR: [{ status: { in: ['SENT', 'UNKNOWN'] }, sentAt: { gte: start } }, { status: 'SENDING' }] };
  const [sent, risky, bounceRows] = await Promise.all([
    db.radarSend.groupBy({ by: ['mailboxId'], where: { mailboxId: { not: null }, ...counted }, _count: { _all: true } }),
    db.radarSend.groupBy({ by: ['mailboxId'], where: { mailboxId: { not: null }, risky: true, ...counted }, _count: { _all: true } }),
    Promise.all(boxes.map(async b => {
      const recent = await db.radarSend.findMany({ where: { mailboxId: b.id, status: { in: ['SENT', 'BOUNCED'] } }, orderBy: { sentAt: 'desc' }, take: config.bounceWindow, select: { status: true } });
      return [b.id, { sent: recent.length, bounced: recent.filter(r => r.status === 'BOUNCED').length }] as const;
    })),
  ]);
  const count = (rows: typeof sent, id: string) => rows.find(r => r.mailboxId === id)?._count._all ?? 0;
  const bounces = new Map(bounceRows);
  return { timezone, todayStart: start, config, boxes: boxes.map(b => ({
    box: b,
    connected: !!b.credential,
    cap: dailyCap(b, config.rampLevels, now),
    sentToday: count(sent, b.id),
    riskyToday: count(risky, b.id),
    week: warmupWeek(b.warmupStartedAt, now) + 1,
    recent: bounces.get(b.id) ?? { sent: 0, bounced: 0 },
  })) };
}

/** Mailboxes for the settings page: no credential, ever. */
export async function listMailboxes(user: Actor) {
  requireAdmin(user, '只有管理员可以查看发信邮箱');
  const { boxes } = await mailboxStates();
  return boxes.map(({ box, ...state }) => ({
    id: box.id, address: box.address, fromName: box.fromName, signature: box.signature, status: box.status, pausedReason: box.pausedReason, pausedAt: box.pausedAt,
    warmupStartedAt: box.warmupStartedAt, capLevel: box.capLevel, capOverride: box.capOverride, nextSendAt: box.nextSendAt, consecutiveFailures: box.consecutiveFailures,
    lastPolledAt: box.lastPolledAt, ...state,
  }));
}
