import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { listMailboxes } from '@/services/radar-mailbox-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await listMailboxes(await requireUser(true))));}
