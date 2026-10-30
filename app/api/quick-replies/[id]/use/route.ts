import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { countReplyUse } from '@/services/quick-reply-service';
export const dynamic='force-dynamic';
/** POST: a reply was filled into the input box (counts towards 最常用). */
export async function POST(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser();return ok(await countReplyUse(user,(await ctx.params).id));});}
