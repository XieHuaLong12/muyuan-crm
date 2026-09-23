import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { resolveQuotePrice } from '@/services/product-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const {id}=await ctx.params;return ok(await resolveQuotePrice(await requireUser(),id,Object.fromEntries(req.nextUrl.searchParams)));});}
