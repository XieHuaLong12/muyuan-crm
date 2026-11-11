import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { saveNote } from '@/services/idea-wall-service';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{id:string}>};
/** POST {target: QUICK_REPLY | MATERIAL}: save a useful note as one of my quick replies, or a screenshot into product materials. */
export async function POST(req:NextRequest,ctx:Ctx){return handle(async()=>ok(await saveNote(await requireUser(),(await ctx.params).id,await req.json())));}
