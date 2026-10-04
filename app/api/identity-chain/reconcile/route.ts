import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { reconcileIdentityChain } from '@/services/identity-chain-service';
export async function POST(req:NextRequest){return handle(async()=>ok(await reconcileIdentityChain(await req.json(),await requireUser(true))));}
