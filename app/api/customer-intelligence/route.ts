import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { overrideCustomerIntelligence,processPendingIntelligence } from '@/services/customer-intelligence-service';
export async function POST(req:NextRequest){return handle(async()=>ok(await processPendingIntelligence(await req.json(),await requireUser())));}
export async function PATCH(req:NextRequest){return handle(async()=>ok(await overrideCustomerIntelligence(await req.json(),await requireUser())));}
