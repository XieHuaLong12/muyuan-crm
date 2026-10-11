import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { saveQuoteRates } from '@/services/quote-template-service';
export const dynamic='force-dynamic';
export async function PUT(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await saveQuoteRates(user,await req.json()));});}
