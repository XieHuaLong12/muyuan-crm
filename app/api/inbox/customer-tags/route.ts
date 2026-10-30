import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { tagCustomer,untagCustomer } from '@/services/customer-tag-service';
export const dynamic='force-dynamic';
// POST {customerId, tagId} or {customerId, name, color}: put a tag on a customer (a new name creates the tag).
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await tagCustomer(await req.json(),user));});}
export async function DELETE(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await untagCustomer(await req.json(),user));});}
