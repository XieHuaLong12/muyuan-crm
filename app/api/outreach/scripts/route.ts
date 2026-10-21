import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createScript,listScripts } from '@/services/outreach-script-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await listScripts(await requireUser())));}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createScript(await req.json(),user),201);});}
