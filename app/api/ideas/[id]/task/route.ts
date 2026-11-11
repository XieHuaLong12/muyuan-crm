import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { noteToTask } from '@/services/idea-wall-service';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{id:string}>};
/** POST: turn an idea into a task for tomorrow; the idea follows the task to 做完了. */
export async function POST(_req:NextRequest,ctx:Ctx){return handle(async()=>ok(await noteToTask(await requireUser(),(await ctx.params).id)));}
