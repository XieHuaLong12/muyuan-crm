import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { setAutoTranslate } from '@/services/message-translation-service';
export const dynamic='force-dynamic';
/** PATCH {customerId, on}: the chat header's 自动翻译 switch. */
export async function PATCH(req:NextRequest){return handle(async()=>ok(await setAutoTranslate(await requireUser(),await req.json())));}
