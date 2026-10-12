import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { getISOWeeksInYear } from 'date-fns';
import { z } from 'zod';
import { Actor, requireAdmin } from '@/lib/auth';
import { localDate } from '@/lib/time';
import { dealsIn } from '@/lib/metrics';

/**
 * Splits an amount into `parts` two-decimal shares that add up exactly to the amount:
 * every share is rounded down to the cent and the leftover cents go to the last share.
 */
export function splitEvenly(amount: Prisma.Decimal.Value, parts: number) {
  const total = new Prisma.Decimal(amount);
  const share = total.div(parts).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  return Array.from({ length: parts }, (_, i) => i === parts - 1 ? total.minus(share.mul(parts - 1)) : share);
}

/** Annual target split into months and ISO weeks; manually edited periods keep their own value. */
export async function allocateTargets(year: number, amount: number, currency: string) {
  return db.$transaction(async tx => {
    await tx.salesTarget.upsert({
      where: { periodKey: `YEAR-${year}` },
      create: { periodKey: `YEAR-${year}`, periodType: 'YEAR', year, targetRevenue: amount, currency, manual: true },
      update: { targetRevenue: amount, manual: true, currency },
    });
    for (const type of ['MONTH', 'WEEK'] as const) {
      const n = type === 'MONTH' ? 12 : getISOWeeksInYear(new Date(year, 6, 1));
      const shares = splitEvenly(amount, n);
      for (let i = 1; i <= n; i++) {
        const key = `${type}-${year}-${i}`;
        const existing = await tx.salesTarget.findUnique({ where: { periodKey: key } });
        if (existing?.manual) continue;
        await tx.salesTarget.upsert({
          where: { periodKey: key },
          create: { periodKey: key, periodType: type, year, month: type === 'MONTH' ? i : null, week: type === 'WEEK' ? i : null, targetRevenue: shares[i - 1], currency },
          update: { targetRevenue: shares[i - 1], currency },
        });
      }
    }
  });
}

const progressInput = z.object({ year: z.coerce.number().int().min(2000).max(2200), currency: z.enum(['CNY', 'USD', 'EUR']) });
/**
 * Monthly target against actual revenue for one year and currency (the targets page chart). Revenue uses the
 * shared deal rule in lib/metrics, the same as the cockpit.
 */
export async function targetProgress(user: Actor, input: unknown) {
  requireAdmin(user);
  const { year, currency } = progressInput.parse(input);
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const monthStart = (month: number) => localDate(`${month > 12 ? year + 1 : year}-${String(month > 12 ? 1 : month).padStart(2, '0')}-01T00:00`, timezone);
  const [deals, targets] = await Promise.all([
    db.deal.findMany({ where: { ...dealsIn({ start: monthStart(1), end: monthStart(13) }, { deletedAt: null }), currency }, select: { dealDate: true, dealAmount: true } }),
    db.salesTarget.findMany({ where: { year, periodType: 'MONTH', currency }, select: { month: true, targetRevenue: true } }),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => {
    const start = monthStart(i + 1), end = monthStart(i + 2);
    const revenue = deals.filter(deal => deal.dealDate >= start && deal.dealDate < end).reduce((sum, deal) => sum.plus(deal.dealAmount), new Prisma.Decimal(0));
    return { month: i + 1, label: `${i + 1}月`, 销售额: revenue.toNumber(), 目标: targets.find(t => t.month === i + 1)?.targetRevenue.toNumber() ?? 0 };
  });
  return { year, currency, months };
}
export type TargetProgress = Awaited<ReturnType<typeof targetProgress>>;
