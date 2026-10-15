import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { translateForCustomer } from '@/services/sales-copilot-service';
export const dynamic='force-dynamic';
/** The salesperson's Chinese, in the customer's language, for the input box (never sent from here). */
export async function POST(req:NextRequest){return handle(async()=>ok(await translateForCustomer(await requireUser(),await req.json())));}
