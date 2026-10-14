import webpush from 'web-push';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor } from '@/lib/auth';
import { openSecret, sealSecret } from '@/lib/secret';

/**
 * System notifications on phones and desktops (Web Push), delivered even when the CRM app is closed. The installed
 * phone app (Android; iPhone from iOS 16.4) and desktop browsers subscribe once; the server pushes when a lead
 * arrives or is assigned.
 */

/** VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set, otherwise generated once and stored encrypted. */
async function vapidKeys() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim(), privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) return { publicKey, privateKey };
  const select = { pushPublicKey: true, pushPrivateKey: true } as const;
  let stored = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select });
  if (!stored.pushPublicKey) {
    const keys = webpush.generateVAPIDKeys();
    // Concurrent first requests: only the first pair is stored, everyone uses the stored one.
    await db.setting.updateMany({ where: { id: 'system', pushPublicKey: '' }, data: { pushPublicKey: keys.publicKey, pushPrivateKey: sealSecret(keys.privateKey) } });
    stored = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select });
  }
  try {
    return { publicKey: stored.pushPublicKey, privateKey: openSecret(stored.pushPrivateKey) };
  } catch {
    // AUTH_SECRET changed: the stored key is unreadable. Start over with a new pair; devices re-register with it the
    // next time the CRM opens on them (components/push-notifications.ts replaces subscriptions made with another key).
    console.warn('[push] stored VAPID key unreadable, generating a new pair');
    await db.setting.update({ where: { id: 'system' }, data: { pushPublicKey: '', pushPrivateKey: '' } });
    return vapidKeys();
  }
}

export async function pushPublicKey() {
  return { publicKey: (await vapidKeys()).publicKey };
}

// The push services of Chrome / Android, Firefox, Edge / Windows and Safari / iPhone. Nothing else is accepted, so
// the server never posts to an address a user typed in.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)$/;
const subscriptionInput = z.object({
  endpoint: z.string().url().max(768).refine(value => { const url = new URL(value); return url.protocol === 'https:' && PUSH_HOSTS.test(url.hostname); }, '不支持的推送服务'),
  keys: z.object({ p256dh: z.string().min(1).max(255), auth: z.string().min(1).max(255) }),
});

/** Saves this device for the signed-in user; a device that was another user's moves to whoever signs in now. */
export async function savePushSubscription(user: Actor, input: unknown, userAgent = '') {
  const v = subscriptionInput.parse(input);
  const data = { userId: user.id, p256dh: v.keys.p256dh, auth: v.keys.auth, userAgent: userAgent.slice(0, 255), failures: 0 };
  await db.pushSubscription.upsert({ where: { endpoint: v.endpoint }, create: { endpoint: v.endpoint, ...data }, update: data });
  return { saved: true };
}

/** Signing out or turning notifications off on this device. */
export async function removePushSubscription(user: Actor, input: unknown) {
  const { endpoint } = z.object({ endpoint: z.string().max(768) }).parse(input);
  const removed = await db.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return { removed: removed.count };
}

export type PushMessage = { title: string; body: string; href: string; tag: string; urgent: boolean };

/** Sends to every device of these users. Devices the push service reports as gone are deleted; errors never throw. */
export async function sendPush(userIds: string[], message: PushMessage) {
  const devices = userIds.length ? await db.pushSubscription.findMany({ where: { userId: { in: [...new Set(userIds)] } } }) : [];
  if (!devices.length) return { sent: 0, failed: 0 };
  const keys = await vapidKeys();
  const admin = await db.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { email: true } });
  const options = {
    vapidDetails: { subject: process.env.VAPID_SUBJECT?.trim() || `mailto:${admin?.email || 'admin@example.com'}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
    // A lead alert is only useful now: high urgency wakes phones in power saving, and it expires after an hour.
    TTL: 3600, urgency: 'high' as const, timeout: 10_000,
  };
  const payload = JSON.stringify({ ...message, at: new Date().toISOString() });
  let sent = 0, failed = 0;
  await Promise.all(devices.map(async device => {
    try {
      await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, options);
      sent++;
      await db.pushSubscription.update({ where: { id: device.id }, data: { lastSuccessAt: new Date(), failures: 0 } });
    } catch (error) {
      failed++;
      const status = (error as { statusCode?: number }).statusCode;
      // 404 / 410: the user uninstalled the app or revoked permission. Ten failures in a row: give up on the device.
      if (status === 404 || status === 410 || device.failures >= 9) await db.pushSubscription.deleteMany({ where: { id: device.id } });
      else await db.pushSubscription.update({ where: { id: device.id }, data: { failures: { increment: 1 } } });
      console.warn('[push] delivery failed', { status: status ?? 'network' });
    }
  }));
  return { sent, failed };
}
