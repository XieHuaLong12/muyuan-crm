import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { saveSalesTarget } from '@/services/sales-team-service';
export async function PUT(req:NextRequest){return handle(async()=>ok(await saveSalesTarget(await req.json(),await requireUser(true))));}
