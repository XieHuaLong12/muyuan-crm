import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { clearTodo,markTodo } from '@/services/todo-service';
export const dynamic='force-dynamic';
// POST {customerId, note, dueAt}: 标为待处理 or change the reminder. DELETE {customerId}: 处理完.
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await markTodo(await req.json(),user));});}
export async function DELETE(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await clearTodo(await req.json(),user));});}
