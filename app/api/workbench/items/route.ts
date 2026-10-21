import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createItem } from '@/services/workbench-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createItem(await req.json(),user),201);});}
