import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { quoteDetail,updateItemizedQuote } from '@/services/itemized-quote-service';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>ok(await quoteDetail(await requireUser(),(await ctx.params).id)));}
export async function PUT(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser();return ok(await updateItemizedQuote((await ctx.params).id,await req.json(),user));});}
