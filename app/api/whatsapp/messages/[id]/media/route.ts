import { NextRequest,NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle } from '@/lib/http';
import { messageMediaAsset } from '@/services/whatsapp-media-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
// A relative Location keeps the browser on the public address even behind a proxy.
export async function GET(_req:NextRequest,ctx:{params:Promise<{id:string}>}){return handle(async()=>{const user=await requireUser();const {id}=await ctx.params;return new NextResponse(null,{status:302,headers:{Location:`/api/whatsapp/media/${await messageMediaAsset(id,user)}`,'Cache-Control':'private, no-store'}});});}
