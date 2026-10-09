import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { salesPerformance } from '@/services/sales-team-service';
export async function GET(req:NextRequest){return handle(async()=>ok(await salesPerformance(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
