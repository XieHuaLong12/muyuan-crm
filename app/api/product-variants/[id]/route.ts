import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { updateVariant } from '@/services/product-service';
export const dynamic='force-dynamic';
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const {id}=await ctx.params;return ok(await updateVariant(await requireUser(),id,await req.json()));});}
