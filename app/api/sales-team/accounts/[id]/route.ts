import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { updateSalesAccount } from '@/services/sales-account-service';
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>ok(await updateSalesAccount((await ctx.params).id,await req.json(),await requireUser(true))));}
