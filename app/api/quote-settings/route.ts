import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { quoteSettings,saveQuoteTemplate } from '@/services/quote-template-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await quoteSettings(await requireUser())));}
export async function PUT(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await saveQuoteTemplate(user,await req.json()));});}
