import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { salesHome } from '@/services/sales-workspace-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await salesHome(await requireUser())));}
