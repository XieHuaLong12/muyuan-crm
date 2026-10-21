import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { outreachDashboard } from '@/services/outreach-analytics-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await outreachDashboard(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
