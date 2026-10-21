import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createFocus } from '@/services/workbench-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createFocus(await req.json(),user),201);});}
