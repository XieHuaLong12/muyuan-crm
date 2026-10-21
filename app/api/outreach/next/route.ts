import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { outreachNextView } from '@/services/outreach-engine-service';
export const dynamic='force-dynamic';
// POST: opening a chat recomputes the customer and assigns the next touch's script (a write, so not a GET).
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await outreachNextView(await req.json(),user));});}
