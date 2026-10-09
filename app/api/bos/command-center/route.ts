import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { commandCenter } from '@/services/bos-command-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await commandCenter(await requireUser(true))));}
