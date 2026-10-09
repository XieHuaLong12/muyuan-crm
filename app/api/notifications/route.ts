import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { notificationFeed } from '@/services/notification-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await notificationFeed(await requireUser())));}
