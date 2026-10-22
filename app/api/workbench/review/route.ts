import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { reviewDay,saveReview } from '@/services/daily-review-service';
export const dynamic='force-dynamic';
// GET ?date=yyyy-MM-dd: the review of a day (today by default). POST: save a draft, submit, or change a submitted review.
export async function GET(req:NextRequest){return handle(async()=>ok(await reviewDay(await requireUser(),Object.fromEntries(req.nextUrl.searchParams))));}
export async function POST(req:NextRequest){return handle(async()=>{const user=await requireUser();return ok(await saveReview(user,await req.json()));});}
