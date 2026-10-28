import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { decideReply } from '@/services/radar-inbox-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser(true);return ok(await decideReply((await ctx.params).id,await req.json(),user));});}
