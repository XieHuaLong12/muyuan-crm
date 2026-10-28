import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { reviewSends } from '@/services/radar-queue-service';
import { reviewReplies } from '@/services/radar-inbox-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>{const user=await requireUser(true);return ok({sends:await reviewSends(user),replies:await reviewReplies(user)});});}
