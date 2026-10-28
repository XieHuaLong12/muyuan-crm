import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { radarStats } from '@/services/radar-analytics-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await radarStats(await requireUser(true))));}
