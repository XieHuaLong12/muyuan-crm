import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { linkCandidates,linkUnmatchedNumber } from '@/services/inbox-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await linkCandidates(await requireUser(true),Object.fromEntries(req.nextUrl.searchParams))));}
export async function POST(req:NextRequest){return handle(async()=>ok(await linkUnmatchedNumber(await requireUser(true),await req.json())));}
