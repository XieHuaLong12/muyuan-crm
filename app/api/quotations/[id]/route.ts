import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { markQuoteSent } from '@/services/quotation-service';
export async function PATCH(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>ok(await markQuoteSent((await ctx.params).id,await requireUser())));}
