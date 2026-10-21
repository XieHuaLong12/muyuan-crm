import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { deleteFocus,updateFocus } from '@/services/workbench-service';
export const dynamic='force-dynamic';
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser();return ok(await updateFocus((await ctx.params).id,await req.json(),user));});}
export async function DELETE(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser();return ok(await deleteFocus((await ctx.params).id,user));});}
