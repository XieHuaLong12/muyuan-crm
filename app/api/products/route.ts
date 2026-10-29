import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { productList } from '@/services/product-service';
import { createProduct } from '@/services/product-admin-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await productList(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
export async function POST(req:NextRequest){return handle(async()=>ok(await createProduct(await requireUser(),await req.json()),201));}
