import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { getExchangeRate,setExchangeRate } from '@/services/product-cost-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await getExchangeRate(await requireUser())));}
export async function PUT(req:NextRequest){return handle(async()=>ok(await setExchangeRate(await requireUser(),await req.json())));}
