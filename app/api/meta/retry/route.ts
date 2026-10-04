import {NextRequest} from 'next/server';
import {requireUser} from '@/lib/auth';
import {handle,ok} from '@/lib/http';
import {retryPendingMetaLeads} from '@/services/meta-lead-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){return handle(async()=>ok(await retryPendingMetaLeads(await req.json(),await requireUser(true))));}
