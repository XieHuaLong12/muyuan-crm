import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { getReminders } from '@/services/workflow-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>{const user=await requireUser();return ok(await getReminders(user));});}
