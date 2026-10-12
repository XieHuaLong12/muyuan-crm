import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { phoneCountry } from '@/lib/phone-country';

/**
 * Existing customers with a blank country get the country of their WhatsApp (or international phone) number.
 * New and edited customers are filled when saved; this catches everyone saved before that. Bounded per call, and
 * a country somebody entered in the meantime is never overwritten.
 */
export async function fillMissingCountries(where: Prisma.CustomerWhereInput = {}, limit = 500) {
  const rows = await db.customer.findMany({
    where: { AND: [where, { deletedAt: null, country: '' }, { OR: [{ whatsapp: { not: '' } }, { waId: { not: null } }, { phone: { not: '' } }] }] },
    select: { id: true, whatsapp: true, waId: true, phone: true, updatedAt: true },
  });
  let filled = 0;
  for (const customer of rows) {
    if (filled >= limit) break;
    const detected = phoneCountry(customer);
    if (!detected) continue;
    // Not an edit: keep updatedAt, so open edit forms and "recently updated" orderings are unaffected.
    const result = await db.customer.updateMany({ where: { id: customer.id, country: '' }, data: { country: detected.name, updatedAt: customer.updatedAt } });
    filled += result.count;
  }
  return { filled };
}
