import type { Prisma } from '@prisma/client';
import { canonicalPhone } from '@/lib/contact-identity';
import { resolveContact } from './contact-identity-service';
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
}, client: Prisma.TransactionClient = db): Promise<WhatsAppCustomerResolution> {
  const waId = normalizeWhatsApp(input.waId);
  const normalized = normalizeWhatsApp(input.phone || input.waId);
  const phone = canonicalPhone(input.phone || input.waId, undefined, true);
  const resolved = await resolveContact({ phones: phone ? [phone] : [] }, client);
  if (resolved.status === 'AMBIGUOUS') return { status:'AMBIGUOUS', normalized, customerIds:resolved.customerIds };
  if (resolved.status !== 'MATCHED') return { status:'NOT_FOUND', normalized };
  const c = await client.customer.findUniqueOrThrow({where:{id:resolved.customerId}});
  if(c.deletedAt)return {status:'AMBIGUOUS',normalized,customerIds:[c.id]};
  const matchedBy = waId && c.waId === waId ? 'WA_ID' : 'NUMBER';
  if(waId && !c.waId)await client.customer.update({where:{id:c.id},data:{waId}});
  return {status:'MATCHED',customerId:c.id,matchedBy};
}
