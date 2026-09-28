import { NextRequest } from 'next/server';
import { handle,ok } from '@/lib/http';
import { authSyncToken,syncWebMessages } from '@/services/whatsapp-web-sync-service';
import { extensionOrigin,options,syncBody,withCors } from '@/lib/whatsapp-web-sync-http';
export async function OPTIONS(req:NextRequest){return handle(async()=>options(req));}
export async function POST(req:NextRequest){
  let origin:string;
  try{origin=extensionOrigin(req);}catch{return handle(async()=>{extensionOrigin(req);return ok(null);});}
  const response=await handle(async()=>{const {device,user}=await authSyncToken(req.headers.get('authorization'));return ok(await syncWebMessages(await syncBody(req),user,device.accountPhone));});
  return withCors(response,origin);
}
