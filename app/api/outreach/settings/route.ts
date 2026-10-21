import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { outreachSettings,saveOutreachSettings } from '@/services/outreach-script-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await outreachSettings(await requireUser())));}
export async function PUT(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await saveOutreachSettings(await req.json(),user));});}
