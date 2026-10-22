import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { stepFocus } from '@/services/workbench-service';
export const dynamic='force-dynamic';
// POST {delta: 1 | -1}: the review's +1 / −1 on a focus with a number target.
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser();return ok(await stepFocus((await ctx.params).id,await req.json(),user));});}
