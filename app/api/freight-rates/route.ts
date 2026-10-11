import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createFreightRate,listFreightRates } from '@/services/freight-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await listFreightRates(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createFreightRate(user,await req.json()),201);});}
