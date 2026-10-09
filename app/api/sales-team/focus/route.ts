import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { firstContactFocus } from '@/services/sales-team-service';
export async function GET(){return handle(async()=>ok(await firstContactFocus(await requireUser())));}
