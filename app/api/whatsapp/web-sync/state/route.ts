import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { syncState } from '@/services/whatsapp-web-sync-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await syncState(await requireUser())));}
