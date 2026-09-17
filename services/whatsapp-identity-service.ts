import { db } from '@/lib/db';
import { normalizeWhatsApp } from '@/lib/whatsapp';

export type WhatsAppCustomerResolution =
  | { status: 'MATCHED'; customerId: string; matchedBy: 'WA_ID' | 'NUMBER' }
  | { status: 'NOT_FOUND'; normalized: string }
  | { status: 'AMBIGUOUS'; normalized: string; customerIds: string[] };

/**
 * Resolve an inbound WhatsApp identity to one CRM customer.
 *
 * waId is preferred when Meta provides it. The normalized phone number is the
 * fallback. We never silently pick one customer when duplicates exist.
 */
export async function resolveWhatsAppCustomer(input: {
  waId?: string | null;
  phone?: string | null;
}): Promise<WhatsAppCustomerResolution> {
  const waId = normalizeWhatsApp(input.waId);
  const normalized = normalizeWhatsApp(input.phone || input.waId);

  if (!waId && !normalized) {
    return { status: 'NOT_FOUND', normalized: '' };
  }

  if (waId) {
    const byWaId = await db.customer.findMany({
      where: { deletedAt: null, waId },
      select: { id: true },
      take: 3,
    });
    if (byWaId.length === 1) {
      return { status: 'MATCHED', customerId: byWaId[0].id, matchedBy: 'WA_ID' };
    }
    if (byWaId.length > 1) {
      return {
        status: 'AMBIGUOUS',
        normalized,
        customerIds: byWaId.map((customer) => customer.id),
      };
    }
  }

  if (!normalized) {
    return { status: 'NOT_FOUND', normalized: '' };
  }

  const byNumber = await db.customer.findMany({
    where: { deletedAt: null, whatsappNormalized: normalized },
    select: { id: true, waId: true },
    take: 3,
  });

  if (byNumber.length === 0) {
    return { status: 'NOT_FOUND', normalized };
  }

  if (byNumber.length > 1) {
    return {
      status: 'AMBIGUOUS',
      normalized,
      customerIds: byNumber.map((customer) => customer.id),
    };
  }

  const customer = byNumber[0];
  if (waId && !customer.waId) {
    await db.customer.update({
      where: { id: customer.id },
      data: { waId },
    });
  }

  return { status: 'MATCHED', customerId: customer.id, matchedBy: 'NUMBER' };
}
