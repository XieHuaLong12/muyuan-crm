import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { draftReplyTranslations } from '@/services/quick-reply-service';
export const dynamic='force-dynamic';
/** POST {zh, languages}: AI first drafts of the language versions, checked by a person before saving. */
export async function POST(req:NextRequest){return handle(async()=>{await requireUser();return ok(await draftReplyTranslations(await req.json()));});}
