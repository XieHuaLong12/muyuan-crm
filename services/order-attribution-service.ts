import { Prisma } from '@prisma/client';

/** Called in the Deal/Order transaction. Historical reconciliation never rewrites a locked snapshot. */
export async function freezeOrderAttribution(tx: Prisma.TransactionClient, orderId: string, customerId: string, orderDate: Date) {
  const existing = await tx.orderAttribution.findUnique({ where: { orderId } });
  if (existing) return existing;
  const where = { customerId, status: 'MATCHED', occurredAt: { lte: orderDate }, adId: { not: null } };
  const [first, last] = await Promise.all([
    tx.customerLeadAttribution.findFirst({ where, orderBy: [{ occurredAt: 'asc' }, { leadKey: 'asc' }] }),
    tx.customerLeadAttribution.findFirst({ where, orderBy: [{ occurredAt: 'desc' }, { leadKey: 'desc' }] }),
  ]);
  const dimension = last?.adId ? await tx.adDimension.findFirst({ where: { adId: last.adId }, orderBy: { syncedAt: 'desc' } }) : null;
  const snapshot = JSON.parse(JSON.stringify({ at: orderDate, firstTouch: first, lastTouch: last, ad: dimension,
    rule: 'LAST_META_TOUCH_BEFORE_ORDER', missingSource: !last, phoneAtOrder: (await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { phoneE164: true } })).phoneE164 })) as Prisma.InputJsonValue;
  return tx.orderAttribution.create({ data: { orderId, status: last ? 'ATTRIBUTED' : 'UNATTRIBUTED',
    firstLeadKey: first?.leadKey, lastLeadKey: last?.leadKey, campaignId: last?.campaignId || dimension?.campaignId,
    adsetId: last?.adsetId || dimension?.adsetId, adId: last?.adId, creativeId: last?.creativeId, snapshot } });
}
