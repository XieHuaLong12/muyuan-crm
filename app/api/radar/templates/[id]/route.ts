import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { updateTemplate } from '@/services/radar-template-service';
export const dynamic='force-dynamic';
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser(true);return ok(await updateTemplate((await ctx.params).id,await req.json(),user));});}
