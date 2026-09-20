import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { updateTask,deleteTask } from '@/services/task-service';
type Context={params:Promise<{id:string}>};
export async function PATCH(req:NextRequest,ctx:Context){return handle(async()=>{const user=await requireUser();return ok(await updateTask((await ctx.params).id,await req.json(),user));});}
export const PUT=PATCH;
export async function DELETE(_req:NextRequest,ctx:Context){return handle(async()=>ok(await deleteTask((await ctx.params).id,await requireUser())));}
