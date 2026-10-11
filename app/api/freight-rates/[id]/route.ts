import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { updateFreightRate } from '@/services/freight-service';
export const dynamic='force-dynamic';
export async function PUT(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser();return ok(await updateFreightRate(user,(await ctx.params).id,await req.json()));});}
