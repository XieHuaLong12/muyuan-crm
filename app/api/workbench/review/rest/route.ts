import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { markRest } from '@/services/daily-review-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await markRest(user,await req.json()));});}
