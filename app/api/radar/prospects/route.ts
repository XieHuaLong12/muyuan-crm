import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { listProspects } from '@/services/radar-prospect-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await listProspects(await requireUser(true),Object.fromEntries(req.nextUrl.searchParams))));}
