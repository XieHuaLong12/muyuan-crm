import {NextRequest} from 'next/server';
import {requireUser} from '@/lib/auth';
import {handle,ok} from '@/lib/http';
import {adIdentityChain} from '@/services/identity-chain-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await adIdentityChain(Object.fromEntries(req.nextUrl.searchParams),await requireUser())));}
