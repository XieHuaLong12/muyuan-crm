import { NextRequest, NextResponse } from 'next/server';
import { HttpError, requireUser } from '@/lib/auth';
import { requestOrigin } from '@/lib/http';
import { mailboxConnectUrl } from '@/services/radar-mailbox-service';
export const dynamic='force-dynamic';

/** A browser navigation from 设置 · 客户雷达: off to Google's consent page, or back to settings with the reason. */
export async function GET(req:NextRequest){
  try{const user=await requireUser(true);return NextResponse.redirect(await mailboxConnectUrl(user,Object.fromEntries(req.nextUrl.searchParams),requestOrigin(req)));}
  catch(error){if(!(error instanceof HttpError))console.error(error);return NextResponse.redirect(new URL(`/settings/radar?mailboxError=${encodeURIComponent(error instanceof HttpError?error.message:'连接失败，请稍后重试')}`,requestOrigin(req)));}
}
