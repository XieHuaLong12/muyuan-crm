import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { addSuppression,listSuppressions } from '@/services/radar-suppression-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await listSuppressions(await requireUser(true),Object.fromEntries(req.nextUrl.searchParams))));}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser(true);return ok(await addSuppression(await req.json(),user),201);});}
