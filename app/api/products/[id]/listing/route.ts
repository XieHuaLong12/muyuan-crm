import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { setListing } from '@/services/product-admin-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const {id}=await ctx.params;return ok(await setListing(await requireUser(),id,await req.json()));});}
