import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { dailySign,drawToday,updateSign } from '@/services/daily-sign-service';
export const dynamic='force-dynamic';
/** GET: today's sign card — the sign if drawn, the evening check, days in a row, this week's sign book. */
export async function GET(){return handle(async()=>ok(await dailySign(await requireUser())));}
/** POST {topic}: draw today's sign (once a day; asking again returns the same one). */
export async function POST(req:NextRequest){return handle(async()=>ok(await drawToday(await requireUser(),await req.json())));}
/** PATCH {action: collect | reopen | verdict, verdict?}: fold it away, open it again, or say in the evening whether it came true. */
export async function PATCH(req:NextRequest){return handle(async()=>ok(await updateSign(await requireUser(),await req.json())));}
