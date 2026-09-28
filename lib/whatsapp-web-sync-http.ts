import { NextRequest, NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth';

export function sameOrigin(req:NextRequest){
  const origin=req.headers.get('origin');
  let valid=false;
  try{const parsed=new URL(origin||'');valid=['http:','https:'].includes(parsed.protocol)&&parsed.host===req.headers.get('host');}catch{}
  if(!valid)throw new HttpError(403,'请求来源无效');
}
export async function syncBody(req:NextRequest){
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'仅接受 JSON');
  const text=await req.text();
  if(Buffer.byteLength(text,'utf8')>2_000_000)throw new HttpError(413,'本次同步数据过大');
  try{return JSON.parse(text) as unknown;}catch{throw new HttpError(400,'JSON 格式无效');}
}
export function extensionOrigin(req:NextRequest){
  const origin=req.headers.get('origin')||'';
  if(!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))throw new HttpError(403,'仅支持 Chrome 或 Edge 扩展');
  return origin;
}
export function withCors(res:Response,origin:string){
  res.headers.set('Access-Control-Allow-Origin',origin);
  res.headers.set('Access-Control-Allow-Headers','authorization, content-type');
  res.headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
  res.headers.set('Vary','Origin');
  res.headers.set('Cache-Control','no-store');
  return res;
}
export function options(req:NextRequest){
  const origin=extensionOrigin(req);
  return withCors(new NextResponse(null,{status:204}),origin);
}
