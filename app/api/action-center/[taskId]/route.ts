import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { taskInsight } from '@/services/action-center-service';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,ctx:{params:Promise<{taskId:string}>}){return handle(async()=>{const {taskId}=await ctx.params;return ok(await taskInsight(await requireUser(),taskId));});}
