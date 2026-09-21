import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { createTask,listTasks } from '@/services/task-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await listTasks(user,Object.fromEntries(req.nextUrl.searchParams)));});}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await createTask(await req.json(),user),201);});}
