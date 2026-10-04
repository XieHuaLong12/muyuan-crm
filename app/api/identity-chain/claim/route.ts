import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { claimIdentityMessage,claimIdentityLead } from '@/services/identity-chain-service';
export async function POST(req:NextRequest){return handle(async()=>ok(await claimIdentityMessage(await req.json(),await requireUser())));}
export async function PATCH(req:NextRequest){return handle(async()=>ok(await claimIdentityLead(await req.json(),await requireUser(true))));}
