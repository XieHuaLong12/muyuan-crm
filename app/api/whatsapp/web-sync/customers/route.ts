import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { searchSyncCustomers } from '@/services/whatsapp-web-sync-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await searchSyncCustomers(req.nextUrl.searchParams.get('q')||'',await requireUser())));}
