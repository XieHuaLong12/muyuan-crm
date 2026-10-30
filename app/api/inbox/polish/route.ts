import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { polishReply } from '@/services/reply-polish-service';
export const dynamic='force-dynamic';
/** POST {customerId, text, avoid?}: three better ways to say the line in the input box (优化话术); nothing is sent. */
export async function POST(req:NextRequest){return handle(async()=>ok(await polishReply(await requireUser(),await req.json())));}
