import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle } from '@/lib/http';
import { noteImage } from '@/services/idea-wall-service';
export const dynamic='force-dynamic';
type Ctx={params:Promise<{id:string}>};
/** GET: the screenshot on one of my notes (only its owner can open it). */
export async function GET(_req:NextRequest,ctx:Ctx){return handle(async()=>{const {bytes,type}=await noteImage(await requireUser(),(await ctx.params).id);return new Response(new Uint8Array(bytes),{headers:{'Content-Type':type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});});}
