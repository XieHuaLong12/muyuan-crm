import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createQuickReply,quickReplyList } from '@/services/quick-reply-service';
export const dynamic='force-dynamic';
// GET ?customerId: company and own replies (and the customer's language and name). POST: a new reply.
export async function GET(req:NextRequest){return handle(async()=>ok(await quickReplyList(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createQuickReply(user,await req.json()),201);});}
