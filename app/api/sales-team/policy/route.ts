import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { saveFirstContactPolicy } from '@/services/sales-team-service';
export async function PUT(req:NextRequest){return handle(async()=>ok(await saveFirstContactPolicy(await req.json(),await requireUser(true))));}
