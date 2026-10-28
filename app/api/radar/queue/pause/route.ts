import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { setSendingPaused } from '@/services/radar-queue-service';
export const dynamic='force-dynamic';
export async function PUT(req:NextRequest){return handle(async()=>{const user=await requireUser(true);return ok(await setSendingPaused(await req.json(),user));});}
