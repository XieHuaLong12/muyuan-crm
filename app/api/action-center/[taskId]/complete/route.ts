import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { completeTask } from '@/services/action-center-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest,ctx:{params:Promise<{taskId:string}>}){return handle(async()=>{const {taskId}=await ctx.params;return ok(await completeTask(await requireUser(),taskId,await req.json().catch(()=>({}))));});}
