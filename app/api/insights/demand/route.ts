import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { demandProfile,scanDemand,updateDemand } from '@/services/demand-profile-service';
export const dynamic='force-dynamic';
const id=(req:NextRequest)=>z.string().trim().min(1).max(191).parse(req.nextUrl.searchParams.get('customerId'));
/** GET ?customerId=: 需求画像 — the fields, what is missing, a question for it, and whether a quotation can be made. */
export async function GET(req:NextRequest){return handle(async()=>ok(await demandProfile(await requireUser(),id(req))));}
/** POST {customerId}: read the customer's words again (rules, then AI); new values wait for a person to confirm. */
export async function POST(req:NextRequest){return handle(async()=>{const body=z.object({customerId:z.string().trim().min(1).max(191)}).parse(await req.json());return ok(await scanDemand(await requireUser(),body.customerId));});}
/** PATCH {action: confirm | confirmAll | set, customerId, field?, value?}: a person confirms or writes a value. */
export async function PATCH(req:NextRequest){return handle(async()=>ok(await updateDemand(await requireUser(),await req.json())));}
