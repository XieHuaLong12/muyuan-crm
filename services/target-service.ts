import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { getISOWeeksInYear } from 'date-fns';

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
