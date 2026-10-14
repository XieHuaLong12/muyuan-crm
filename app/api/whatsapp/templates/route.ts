import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { listTemplates,sendTemplateMessage } from '@/services/whatsapp-template-service';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){return handle(async()=>ok(await listTemplates(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
export async function POST(req:NextRequest){return handle(async()=>ok(await sendTemplateMessage(await req.json(),await requireUser())));}
