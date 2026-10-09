import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { adsAnalytics } from '@/services/identity-analytics-service';
export async function GET(req:NextRequest){return handle(async()=>ok(await adsAnalytics(Object.fromEntries(req.nextUrl.searchParams),await requireUser(true))));}
