import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor } from '@/lib/auth';

/**
 * Small server pieces the native apps (LVANJUBOS for HarmonyOS / Android) need beyond the PC endpoints.
 * Read-only or per-user only; nothing here changes customers, orders or permissions.
 */

/** 提醒已读：the time up to which this person has seen the reminders, on any device; null = never opened. */
export async function notificationSeen(user: Actor) {
  const row = await db.notificationSeen.findUnique({ where: { userId: user.id }, select: { seenAt: true } });
  return { seenAt: row ? row.seenAt.toISOString() : null };
}

const seenInput = z.object({ seenAt: z.string().datetime({ offset: true }) });

/**
 * Moves the read point forward (never back, never past now): a phone with an older feed cannot make reminders
 * already read on another device unread again.
 */
export async function markNotificationsSeen(user: Actor, input: unknown, now = new Date()) {
  const { seenAt } = seenInput.parse(input);
  const at = new Date(Math.min(Date.parse(seenAt), now.getTime()));
  await db.notificationSeen.upsert({ where: { userId: user.id }, create: { userId: user.id, seenAt: at }, update: {} });
  await db.notificationSeen.updateMany({ where: { userId: user.id, seenAt: { lt: at } }, data: { seenAt: at } });
  return notificationSeen(user);
}

/** Platforms with their own release channel. */
export const APP_PLATFORMS = ['harmony', 'android'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

/**
 * The newest app build, from the server environment (set when a build is published for internal distribution):
 * MOBILE_<PLATFORM>_VERSION (e.g. 1.3.0), MOBILE_<PLATFORM>_VERSION_CODE (e.g. 1003000), MOBILE_<PLATFORM>_URL
 * (download page), MOBILE_<PLATFORM>_NOTES (what changed), MOBILE_<PLATFORM>_MIN_VERSION_CODE (older builds must update).
 * Nothing set = no update is offered.
 */
export function appVersion(platformInput: unknown, env: Record<string, string | undefined> = process.env) {
  const platform = z.enum(APP_PLATFORMS).parse(platformInput);
  const prefix = `MOBILE_${platform.toUpperCase()}_`;
  const read = (key: string) => (env[`${prefix}${key}`] ?? '').trim();
  const code = (key: string) => {
    const value = Number(read(key));
    return Number.isInteger(value) && value > 0 ? value : null;
  };
  const versionName = read('VERSION'), versionCode = code('VERSION_CODE'), url = read('URL');
  const latest = versionName && versionCode && /^https:\/\//.test(url) ? { versionName, versionCode, url, notes: read('NOTES') } : null;
  return { platform, latest, minVersionCode: latest ? code('MIN_VERSION_CODE') : null };
}
