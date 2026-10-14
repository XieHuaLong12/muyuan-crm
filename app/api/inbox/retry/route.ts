import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { retryUnmatchedNumbers } from '@/services/inbox-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){return handle(async()=>ok(await retryUnmatchedNumbers(await requireUser(true),await req.json().catch(()=>({})))));}
