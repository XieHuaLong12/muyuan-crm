import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { scriptTouches } from '@/services/outreach-analytics-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser();return ok(await scriptTouches((await ctx.params).id,user,Object.fromEntries(req.nextUrl.searchParams)));});}
