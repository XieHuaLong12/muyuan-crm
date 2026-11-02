import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { customerJourney } from '@/services/entry-time-service';
export const dynamic='force-dynamic';
/** GET ?customerId=: 进线时间 (company and customer time, outside work hours) and what happened after, in order. */
export async function GET(req:NextRequest){return handle(async()=>ok(await customerJourney(await requireUser(),z.string().trim().min(1).max(191).parse(req.nextUrl.searchParams.get('customerId')))));}
