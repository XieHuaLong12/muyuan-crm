import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { inboxConversations } from '@/services/inbox-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await inboxConversations(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
