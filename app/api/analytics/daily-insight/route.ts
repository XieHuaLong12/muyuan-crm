import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { dailyAdvertisingInsight } from '@/services/identity-analytics-service';
export async function POST(req:NextRequest){return handle(async()=>ok(await dailyAdvertisingInsight(await req.json(),await requireUser(true))));}
