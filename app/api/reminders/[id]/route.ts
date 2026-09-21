import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { dismissReminder } from '@/services/workflow-service';
export async function PATCH(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>ok(await dismissReminder((await ctx.params).id,await requireUser())));}
