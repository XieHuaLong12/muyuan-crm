import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { translateMessage } from '@/services/message-translation-service';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){return handle(async()=>ok(await translateMessage(await requireUser(),await req.json())));}
