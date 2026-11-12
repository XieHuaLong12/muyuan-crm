import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { markNotificationsSeen, notificationSeen } from '@/services/mobile-app-service';
export const dynamic = 'force-dynamic';
/** GET: up to when this person has read the reminders (any device). PUT {seenAt}: move that point forward. */
export async function GET() {
  return handle(async () => ok(await notificationSeen(await requireUser())));
}
export async function PUT(req: NextRequest) {
  return handle(async () => ok(await markNotificationsSeen(await requireUser(), await req.json())));
}
