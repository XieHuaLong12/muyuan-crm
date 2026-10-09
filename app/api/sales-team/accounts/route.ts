import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { salesAccounts,createUserAccount } from '@/services/sales-account-service';
export async function GET(){return handle(async()=>ok(await salesAccounts(await requireUser(true))));}
export async function POST(req:NextRequest){return handle(async()=>ok(await createUserAccount({...await req.json(),role:'SALES'},await requireUser(true)),201));}
