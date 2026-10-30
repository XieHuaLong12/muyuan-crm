import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { attachMaterials,materialPicker } from '@/services/sales-material-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// GET ?customerId&q: the chat's 产品资料 panel. POST {customerId, items}: copy the chosen files into the customer's attachments.
export async function GET(req:NextRequest){return handle(async()=>ok(await materialPicker(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await attachMaterials(user,await req.json()));});}
