import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { gupshupIntegrationStatus } from '@/services/gupshup-integration-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await gupshupIntegrationStatus(Object.fromEntries(req.nextUrl.searchParams),await requireUser(true))));}
