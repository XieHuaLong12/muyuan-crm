import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { sameOrigin,syncBody } from '@/lib/whatsapp-web-sync-http';
import { createSyncToken } from '@/services/whatsapp-web-sync-service';
export async function POST(req:NextRequest){return handle(async()=>{sameOrigin(req);const user=await requireUser();return ok(await createSyncToken(await syncBody(req),user),201);});}
