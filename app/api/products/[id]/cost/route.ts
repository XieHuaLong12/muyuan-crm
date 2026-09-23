import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { productCostSummary } from '@/services/product-cost-service';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const {id}=await ctx.params;return ok(await productCostSummary(await requireUser(),id));});}
