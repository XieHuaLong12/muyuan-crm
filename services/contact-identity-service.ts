import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { canonicalEmail, canonicalPhone, metaLeadKey } from '@/lib/contact-identity';
import { leadFeedback } from './advertising-feedback-service';
import { retryTransaction } from '@/lib/transaction-retry';

type Client = Prisma.TransactionClient;
export type ContactResolution = { status: 'MATCHED'; customerId: string; method: 'LEAD_ID' | 'PHONE' | 'EMAIL' } |
  { status: 'UNMATCHED' | 'AMBIGUOUS'; customerIds: string[]; method: 'NONE' | 'PHONE' | 'EMAIL' | 'LEAD_ID' };

/** Shared lock across CSV, webhook, customer edits and manual claims; no network under this lock. */
export async function lockIdentity(tx: Client) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM Setting WHERE id = 'system' FOR UPDATE`);
}

/**
 * Row lock for facts that belong to one customer (follow-ups, quotes, workflow events, non-contact edits).
 * These never create or move contact identities, so they do not need the global identity lock.
 */
export async function lockCustomer(tx: Client, customerId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM Customer WHERE id = ${customerId} FOR UPDATE`);
}

export async function rememberCustomerContacts(tx: Client, customerId: string, source: string) {
  const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
  const phone = canonicalPhone(c.phone, c.countryCode);
  const whatsapp = canonicalPhone(c.whatsapp, undefined, true);
  const waId = canonicalPhone(c.waId, undefined, true);
  const email = canonicalEmail(c.email);
  for (const [rawValue, normalized] of [[c.phone, phone], [c.whatsapp, whatsapp], [c.waId || '', waId]]) {
    if (normalized) await tx.contactIdentity.upsert({
      where: { customerId_kind_normalized: { customerId, kind: 'PHONE', normalized } },
      create: { customerId, kind: 'PHONE', normalized, rawValue: rawValue!, source }, update: {},
    });
  }
  if (email) await tx.contactIdentity.upsert({
    where: { customerId_kind_normalized: { customerId, kind: 'EMAIL', normalized: email } },
    create: { customerId, kind: 'EMAIL', normalized: email, rawValue: c.email, source }, update: {},
  });
  const phoneE164=phone||whatsapp||waId;
  // contactKeysAt marks that canonical keys and aliases exist, so lookups no longer scan this row in memory.
  if(c.phoneE164!==phoneE164||c.emailNormalized!==email||!c.contactKeysAt)await tx.customer.update({where:{id:customerId},data:{phoneE164,emailNormalized:email,contactKeysAt:c.contactKeysAt??new Date()}});
}

function resolution(ids: string[], method: 'LEAD_ID' | 'PHONE' | 'EMAIL'): ContactResolution {
  const unique = [...new Set(ids)];
  return unique.length === 1 ? { status: 'MATCHED', customerId: unique[0], method } :
    { status: unique.length ? 'AMBIGUOUS' : 'UNMATCHED', customerIds: unique, method };
}

export async function resolveContact(input: { leadId?: string; phones?: string[]; email?: string }, tx: Client = db): Promise<ContactResolution> {
  if (input.leadId) {
    const key = metaLeadKey(input.leadId);
    const [ledger, submission, event] = await Promise.all([
      tx.customerLeadAttribution.findUnique({ where: { leadKey: key } }),
      tx.leadSubmission.findUnique({ where: { eventKey: key }, select: { customerId: true } }),
      tx.metaLeadEvent.findUnique({ where: { leadgenId: key.slice(5) }, select: { customerId: true } }),
    ]);
    const ids = [ledger?.customerId, submission?.customerId, event?.customerId].filter((id): id is string => !!id);
    if (ids.length) return resolution(ids, 'LEAD_ID');
    if (ledger?.status === 'AMBIGUOUS') return { status: 'AMBIGUOUS', customerIds: [], method: 'LEAD_ID' };
  }
  const phones = [...new Set(input.phones || [])];
  const email = canonicalEmail(input.email);
  for (const kind of ['PHONE', 'EMAIL'] as const) {
    const values = kind === 'PHONE' ? phones : email ? [email] : [];
    if (!values.length) continue;
    const aliases = await tx.contactIdentity.findMany({ where: { kind, normalized: { in: values } }, select: { customerId: true } });
    const indexed = await tx.customer.findMany({
      where: kind === 'PHONE' ? { OR: [{ phoneE164: { in: values } }, { whatsappNormalized: { in: values.map(v => v.slice(1)) } }, { waId: { in: values.map(v => v.slice(1)) } }] } : { OR: [{ emailNormalized: { in: values } }, { email: { in: values } }] },
      select: { id: true },
    });
    const ids = [...aliases.map(a => a.customerId), ...indexed.map(c => c.id)];
    // Transitional, bounded pages for records whose keys were never computed; no query changes history on read.
    let cursor: string | undefined;
    while (true) {
      const legacy = await tx.customer.findMany({ where: { contactKeysAt: null, ...(kind === 'PHONE' ? { phoneE164: null } : { emailNormalized: null }) },
        select: { id: true, phone: true, whatsapp: true, waId: true, countryCode: true, email: true }, orderBy: { id: 'asc' }, take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const c of legacy) {
        const keys = kind === 'PHONE' ? [canonicalPhone(c.phone, c.countryCode), canonicalPhone(c.whatsapp, undefined, true), canonicalPhone(c.waId, undefined, true)] : [canonicalEmail(c.email)];
        if (keys.some(key => key && values.includes(key))) ids.push(c.id);
      }
      if (legacy.length < 200) break;
      cursor = legacy[legacy.length - 1].id;
    }
    if (ids.length) return resolution(ids, kind);
  }
  return { status: 'UNMATCHED', customerIds: [], method: 'NONE' };
}

type LeadInput = Omit<Prisma.CustomerLeadAttributionUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>;
/** A lead never changes its Customer silently, including after import or retry. */
export async function recordLeadAttribution(tx: Client, input: LeadInput, additionalPhones: {raw: string; normalized: string}[] = []) {
  if(input.customerId){
    if(input.phoneE164)await tx.contactIdentity.upsert({where:{customerId_kind_normalized:{customerId:input.customerId,kind:'PHONE',normalized:input.phoneE164}},create:{customerId:input.customerId,kind:'PHONE',normalized:input.phoneE164,rawValue:input.phoneRaw||input.phoneE164,source:`META_${input.source}`},update:{}});
    // A form may contain different phone and WhatsApp numbers. Keep both as historical aliases.
    for (const phone of additionalPhones) await tx.contactIdentity.upsert({
      where: {customerId_kind_normalized: {customerId: input.customerId, kind: 'PHONE', normalized: phone.normalized}},
      create: {customerId: input.customerId, kind: 'PHONE', normalized: phone.normalized, rawValue: phone.raw, source: `META_${input.source}`}, update: {},
    });
    if(input.emailNormalized)await tx.contactIdentity.upsert({where:{customerId_kind_normalized:{customerId:input.customerId,kind:'EMAIL',normalized:input.emailNormalized}},create:{customerId:input.customerId,kind:'EMAIL',normalized:input.emailNormalized,rawValue:input.emailNormalized,source:`META_${input.source}`},update:{}});
  }
  const existing = await tx.customerLeadAttribution.findUnique({ where: { leadKey: input.leadKey } });
  if (existing?.customerId && input.customerId && existing.customerId !== input.customerId) throw new Error('同一 Meta Lead 已关联其他客户，必须人工核对');
  if (!existing) {
    const lead=await tx.customerLeadAttribution.create({data:input});
    await leadFeedback(tx,lead);
    return lead;
  }
  const enrich: Prisma.CustomerLeadAttributionUncheckedUpdateInput = {};
  for (const key of ['leadId','occurredAt','phoneRaw','phoneE164','emailNormalized','platform','accountId','campaignId','campaignName','adsetId','adsetName','adId','adName','creativeId','creativeName','formId','formName'] as const) {
    if (existing[key] === null && input[key] != null) Object.assign(enrich, { [key]: input[key] });
  }
  if (!existing.customerId && input.customerId) Object.assign(enrich, { customerId: input.customerId, status: input.status, matchMethod: input.matchMethod, confidence: input.confidence });
  const lead=await tx.customerLeadAttribution.update({ where: { id: existing.id }, data: enrich });
  await leadFeedback(tx,lead);
  return lead;
}

/**
 * Computes canonical keys for customers created before they existed (scheduled job). Same work as
 * saving the customer: no contact value changes, only phoneE164 / emailNormalized and alias rows.
 */
export async function backfillContactKeys(limit = 500) {
  const rows = await db.customer.findMany({ where: { contactKeysAt: null }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
  for (const row of rows) {
    await retryTransaction(() => db.$transaction(async tx => {
      await lockIdentity(tx);
      await rememberCustomerContacts(tx, row.id, 'BACKFILL');
    }));
  }
  return { processed: rows.length, remaining: await db.customer.count({ where: { contactKeysAt: null } }) };
}
