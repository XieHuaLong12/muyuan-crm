import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { identityChain } from '@/services/identity-chain-service';
export async function GET(req:NextRequest){return handle(async()=>ok(await identityChain(Object.fromEntries(req.nextUrl.searchParams),await requireUser())));}
