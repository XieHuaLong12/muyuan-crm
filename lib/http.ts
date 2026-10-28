import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { HttpError } from './auth';
export const ok=(data:unknown,status=200)=>NextResponse.json({success:true,data}, {status});
export async function handle(fn:()=>Promise<Response>){try{return await fn();}catch(error){if(error instanceof ZodError)return NextResponse.json({success:false,error:error.issues.map(i=>i.message).join('；')},{status:400});if(error instanceof HttpError)return NextResponse.json({success:false,error:error.message,details:error.details},{status:error.status});console.error(error);return NextResponse.json({success:false,error:'操作失败，请稍后重试'},{status:500});}}
/** The address the browser used (behind Hostinger's proxy the request URL is internal): for redirects back to the CRM. */
export function requestOrigin(req:{headers:Headers;nextUrl:{origin:string}}){const host=req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();const proto=req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();return host?`${proto||'https'}://${host}`:req.nextUrl.origin;}
