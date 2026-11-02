import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { lossSuggestion } from '@/services/demand-profile-service';
export const dynamic='force-dynamic';
/** GET ?customerId=: the loss reason the customer's words point to, a competitor's price they named, and our last quoted price. */
export async function GET(req:NextRequest){return handle(async()=>ok(await lossSuggestion(await requireUser(),z.string().trim().min(1).max(191).parse(req.nextUrl.searchParams.get('customerId')))));}
