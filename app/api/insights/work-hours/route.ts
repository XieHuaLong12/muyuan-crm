import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { updateWorkHours,workHoursSettings } from '@/services/entry-time-service';
export const dynamic='force-dynamic';
export async function GET(){return handle(async()=>{await requireUser();return ok(await workHoursSettings());});}
/** PATCH {start,end}: the working hours (company time zone) used by 进线时间, the country card and the plan. Administrators only. */
export async function PATCH(req:NextRequest){return handle(async()=>ok(await updateWorkHours(await requireUser(true),await req.json())));}
