import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { canonicalEmail } from '@/lib/contact-identity';
import { emailDomain, isFreeMail } from '@/lib/radar';
import { resolveActiveContact } from './contact-identity-service';

type Client = Prisma.TransactionClient | typeof db;

/**
 * The customer radar's only door into the customer center (docs/CUSTOMER_RADAR_COLD_EMAIL.md §7.3): radar data never
 * enters Customer, it only asks whether a company is already there.
 */

/**
 * A live customer (not in the recycle bin) that is this company: same e-mail address or phone number, or an
 * address on the company's own domain. A webmail domain says nothing about the company, so it never matches.
 */
export async function findBosCustomer(input: { emails?: string[]; phones?: string[]; domain?: string }, client: Client = db) {
  const tx = client as Prisma.TransactionClient;
  const ids: string[] = [];
  for (const email of [...new Set((input.emails ?? []).map(canonicalEmail).filter((e): e is string => !!e))]) {
    const found = await resolveActiveContact({ email }, tx);
    ids.push(...(found.status === 'MATCHED' ? [found.customerId] : found.customerIds));
    if (ids.length) break;
  }
  const phones = [...new Set((input.phones ?? []).filter(Boolean))];
  if (!ids.length && phones.length) {
    const found = await resolveActiveContact({ phones }, tx);
    ids.push(...(found.status === 'MATCHED' ? [found.customerId] : found.customerIds));
  }
  const domains = [...new Set([input.domain ?? '', ...(input.emails ?? []).map(emailDomain)].filter(d => d && !isFreeMail(d)))];
  if (!ids.length && domains.length) {
    const byDomain = await tx.customer.findFirst({
      where: { deletedAt: null, OR: domains.flatMap(d => [{ emailNormalized: { endsWith: `@${d}` } }, { email: { endsWith: `@${d}` } }]) },
      select: { id: true }, orderBy: { createdAt: 'asc' },
    });
    if (byDomain) ids.push(byDomain.id);
  }
  if (!ids.length) return null;
  return tx.customer.findFirst({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true, companyName: true, ownerId: true }, orderBy: { createdAt: 'asc' } });
}
