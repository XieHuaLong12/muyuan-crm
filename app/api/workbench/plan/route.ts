import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { planDay } from '@/services/workbench-service';
export const dynamic='force-dynamic';
// POST: lays out today (fixed items, time blocks, carried items); the page calls it on opening. Idempotent.
export async function POST(){return handle(async()=>ok(await planDay(await requireUser())));}
