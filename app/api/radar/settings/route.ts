import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { radarSettings,saveRadarConfig } from '@/services/radar-config-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>ok(await radarSettings(await requireUser(true))));}
export async function PUT(req:NextRequest){return handle(async()=>{const user=await requireUser(true);return ok(await saveRadarConfig(await req.json(),user));});}
