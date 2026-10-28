import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { reviewSends } from '@/services/radar-queue-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok({sends:await reviewSends(await requireUser(true))}));}
