import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { changeOrderMilestone,orderDetail } from '@/services/order-service';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const {id}=await ctx.params;return ok(await orderDetail(await requireUser(),id));});}
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const {id}=await ctx.params;return ok(await changeOrderMilestone(await requireUser(),id,await req.json()));});}
