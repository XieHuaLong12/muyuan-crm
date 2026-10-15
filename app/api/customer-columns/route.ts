import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { customerColumns,resetCustomerColumns,saveCustomerColumns } from '@/services/user-view-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>{const user=await requireUser();return ok(await customerColumns(user));});}
export async function PUT(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await saveCustomerColumns(await req.json(),user));});}
export async function DELETE(){return handle(async()=>{const user=await requireUser();return ok(await resetCustomerColumns(user));});}
