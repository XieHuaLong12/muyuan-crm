import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { db } from '@/lib/db';
import { accessible } from '@/services/customer-service';
import { createQuotation } from '@/services/quotation-service';
export async function GET(req:NextRequest){return handle(async()=>{const user=await requireUser();const customerId=req.nextUrl.searchParams.get('customerId')||'';await accessible(customerId,user);return ok(await db.quotation.findMany({where:{customerId},orderBy:{createdAt:'desc'}}));});}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createQuotation(await req.json(),user),201);});}
