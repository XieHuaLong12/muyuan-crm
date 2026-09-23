import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { upsertCost } from '@/services/product-cost-service';
export const dynamic='force-dynamic';
export async function PUT(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const {id}=await ctx.params;return ok(await upsertCost(await requireUser(),id,await req.json()));});}
