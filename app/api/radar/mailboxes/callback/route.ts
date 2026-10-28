import { NextRequest, NextResponse } from 'next/server';
import { HttpError, requireUser } from '@/lib/auth';
import { requestOrigin } from '@/lib/http';
import { GmailError } from '@/lib/gmail';
import { connectMailbox } from '@/services/radar-mailbox-service';
export const dynamic='force-dynamic';

/** Google's redirect after consent: stores the mailbox, then back to settings saying what happened. */
export async function GET(req:NextRequest){
  const back=(params:string)=>NextResponse.redirect(new URL(`/settings/radar?${params}`,requestOrigin(req)));
  try{const user=await requireUser(true);const result=await connectMailbox(user,Object.fromEntries(req.nextUrl.searchParams),requestOrigin(req));return back(`mailboxConnected=${encodeURIComponent(result.address)}`);}
  catch(error){const known=error instanceof HttpError||error instanceof GmailError;if(!known)console.error(error);return back(`mailboxError=${encodeURIComponent(known?(error as Error).message:'连接失败，请稍后重试')}`);}
}
