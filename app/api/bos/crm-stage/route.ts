import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { moveCustomerStage } from '@/services/bos-crm-service';
export async function PATCH(request:Request){return handle(async()=>ok(await moveCustomerStage(await requireUser(),await request.json())));}
