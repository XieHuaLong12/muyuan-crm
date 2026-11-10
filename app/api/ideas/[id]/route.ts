import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { updateNote } from '@/services/idea-wall-service';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{id:string}>};
/** PATCH {text?, source?, color?, status?, kind?, tags?, pinned?, archived?, remindOn?}: change one of my notes. */
export async function PATCH(req:NextRequest,ctx:Ctx){return handle(async()=>ok(await updateNote(await requireUser(),(await ctx.params).id,await req.json())));}
