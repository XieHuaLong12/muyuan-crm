import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { previewEnqueue } from '@/services/radar-queue-service';
export const dynamic='force-dynamic';
/** Read only: POST because the selection travels in the body. */
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser(true);return ok(await previewEnqueue(await req.json(),user));});}
