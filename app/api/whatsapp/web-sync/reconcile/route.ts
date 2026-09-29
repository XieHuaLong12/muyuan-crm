import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { sameOrigin } from '@/lib/whatsapp-web-sync-http';
import { reconcilePendingWebSync } from '@/services/whatsapp-web-sync-service';
export async function POST(req:NextRequest){return handle(async()=>{sameOrigin(req);return ok(await reconcilePendingWebSync(await requireUser()));});}
