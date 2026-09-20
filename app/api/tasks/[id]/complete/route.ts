import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { updateTask } from '@/services/task-service';
export async function POST(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>ok(await updateTask((await ctx.params).id,{status:'DONE'},await requireUser())));}
