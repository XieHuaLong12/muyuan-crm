import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { sameOrigin } from '@/lib/whatsapp-web-sync-http';
import { revokeSyncToken } from '@/services/whatsapp-web-sync-service';
export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){return handle(async()=>{sameOrigin(req);const user=await requireUser();const {id}=await params;return ok(await revokeSyncToken(id,user));});}
