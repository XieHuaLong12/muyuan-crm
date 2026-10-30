import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { translateBatch } from '@/services/message-translation-service';
export const dynamic='force-dynamic';
/** POST {customerId, messageIds}: Chinese for the newest untranslated messages on screen, stored for everyone. */
export async function POST(req:NextRequest){return handle(async()=>ok(await translateBatch(await requireUser(),await req.json())));}
