import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { deleteQuickReply,updateQuickReply } from '@/services/quick-reply-service';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{id:string}>};
export async function PATCH(req:NextRequest,ctx:Ctx){return handle(async()=>{const user=await requireUser();return ok(await updateQuickReply(user,(await ctx.params).id,await req.json()));});}
export async function DELETE(_req:NextRequest,ctx:Ctx){return handle(async()=>{const user=await requireUser();return ok(await deleteQuickReply(user,(await ctx.params).id));});}
