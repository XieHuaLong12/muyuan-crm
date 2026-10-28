import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { deleteSuppression } from '@/services/radar-suppression-service';
export const dynamic='force-dynamic';
export async function DELETE(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser(true);return ok(await deleteSuppression((await ctx.params).id,user));});}
