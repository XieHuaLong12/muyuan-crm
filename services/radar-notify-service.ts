import { db } from '@/lib/db';
import { sendPush } from './push-service';

/** Rings every active administrator about something on the customer radar that needs a person. Never throws. */
export async function notifyAdmins(title: string, body: string, href: string, tag: string, ttlSeconds = 12 * 3600) {
  try {
    const admins = await db.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    return await sendPush(admins.map(a => a.id), { title, body: body.slice(0, 180), href, tag, urgent: false }, ttlSeconds);
  } catch (error) {
    console.warn('[radar] alert failed', { tag, error: error instanceof Error ? error.message : 'unknown' });
    return { sent: 0, failed: 0 };
  }
}
