import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { approveSends } from '@/services/radar-queue-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser(true);return ok(await approveSends(await req.json(),user));});}
