import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { growthCenter } from '@/services/bos-growth-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await growthCenter(await requireUser(true),Object.fromEntries(req.nextUrl.searchParams))));}
