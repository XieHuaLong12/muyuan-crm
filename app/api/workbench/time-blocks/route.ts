import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createTimeBlock,listTimeBlocks } from '@/services/workbench-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await listTimeBlocks(await requireUser())));}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createTimeBlock(await req.json(),user),201);});}
