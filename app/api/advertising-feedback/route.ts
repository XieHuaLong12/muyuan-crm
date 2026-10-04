import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
export const dynamic='force-dynamic';
import { recomputeAdvertisingFeedback,deliverAdvertisingFeedback } from '@/services/advertising-feedback-service';
export async function POST(req:NextRequest){return handle(async()=>ok(await recomputeAdvertisingFeedback(await req.json(),await requireUser())));}
export async function PATCH(req:NextRequest){return handle(async()=>ok(await deliverAdvertisingFeedback(await req.json(),await requireUser(true))));}
