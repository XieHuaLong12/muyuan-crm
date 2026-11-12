import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { businessCockpit } from '@/services/business-cockpit-service';
export const dynamic = 'force-dynamic';
/**
 * GET ?range=today|week|month|quarter|year|custom&startDate&endDate: the 驾驶舱 numbers (revenue trend, orders,
 * funnel, channels) for the mobile app. Same service as the PC command center; sales get their own customers only
 * and no profit (services/business-cockpit-service.ts). Read-only.
 */
export async function GET(req: NextRequest) {
  return handle(async () => ok(await businessCockpit(await requireUser(), Object.fromEntries(req.nextUrl.searchParams))));
}
