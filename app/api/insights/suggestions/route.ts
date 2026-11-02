import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { decideSuggestion } from '@/services/ai-plan-service';
export const dynamic='force-dynamic';
/** POST {id, status: ADOPTED | IGNORED | PENDING}: adopt, ignore or take back an ad suggestion. The ad itself is changed in Meta by a person. */
export async function POST(req:NextRequest){return handle(async()=>ok(await decideSuggestion(await requireUser(true),await req.json())));}
