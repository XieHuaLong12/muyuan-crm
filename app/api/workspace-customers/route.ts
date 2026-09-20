import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { priorityCustomers } from '@/services/sales-workspace-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await priorityCustomers(await requireUser())));}
