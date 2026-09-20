import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { recordWorkflowEvent } from '@/services/workflow-service';
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await recordWorkflowEvent(await req.json(),user),201);});}
