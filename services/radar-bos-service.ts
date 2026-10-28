import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { canonicalEmail, canonicalPhone } from '@/lib/contact-identity';
import { countryName } from '@/lib/phone-country';
import { retryTransaction } from '@/lib/transaction-retry';
import { CUSTOMER_TYPES, emailDomain, isFreeMail } from '@/lib/radar';
import { INTENTS, REPLY_CATEGORIES, threadLink } from '@/lib/radar-reply';
import { lockIdentity, rememberCustomerContacts, resolveActiveContact } from './contact-identity-service';
import { enterIntake, intakeAdmin, resolveIntakeOwner } from './lead-assignment-service';
import { queueLeadAlert } from './lead-alert-service';
import { suppress } from './radar-suppression-service';

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

// ─── Valid replies into the customer center ─────────────

/** Radar customer types as the customer center's purchase types (lib/constants.ts). */
const PURCHASE_TYPE: Record<string, string> = { WHOLESALER: 'WHOLESALE', IMPORTER: 'IMPORTER', FURNITURE_STORE: 'RETAILER', MATTRESS_STORE: 'RETAILER' };
const day = (d: Date) => d.toISOString().slice(0, 10);
type Extracted = { contactName?: string; title?: string; phone?: string; whatsapp?: string; email?: string; products?: string; quantity?: string; targetPrice?: string; timeline?: string };
type ReplyRow = Prisma.RadarReplyGetPayload<{ include: { prospect: true; mailbox: true; send: true; sequence: true } }>;

/** The reply as a block for the customer's notes: the salesperson reads the original and the summary there. */
function noteBlock(reply: ReplyRow) {
  const x = (reply.extracted ?? {}) as Extracted;
  const facts = [x.contactName && `联系人 ${x.contactName}${x.title ? `（${x.title}）` : ''}`, x.products && `关注产品 ${x.products}`, x.quantity && `数量 ${x.quantity}`,
    x.targetPrice && `目标价 ${x.targetPrice}`, x.timeline && `时间 ${x.timeline}`, x.phone && `电话 ${x.phone}`, x.whatsapp && `WhatsApp ${x.whatsapp}`, x.email && `新邮箱 ${x.email}`].filter(Boolean);
  return [
    `【客户雷达 · 开发信回复 ${day(reply.receivedAt)}】${reply.send ? `${reply.send.templateCode} 第 ${reply.send.step} 封` : ''}`,
    reply.category && `分类：${REPLY_CATEGORIES[reply.category as keyof typeof REPLY_CATEGORIES] ?? reply.category}${reply.intent ? ` · 意向${INTENTS[reply.intent as keyof typeof INTENTS] ?? ''}` : ''}`,
    reply.summary && `摘要：${reply.summary}`,
    facts.length ? `提取：${facts.join('；')}` : '',
    `来信：${reply.fromName ? `${reply.fromName} ` : ''}<${reply.fromAddress}>`,
    `原文：\n${reply.text.slice(0, 3000)}`,
    reply.threadId ? `在邮箱中打开回复：${threadLink(reply.mailbox.address, reply.threadId)}` : '',
  ].filter(Boolean).join('\n');
}
const followUpText = (reply: ReplyRow) => `开发信回复：${reply.summary || reply.text.replace(/\s+/g, ' ')}`.slice(0, 191);

/**
 * A valid reply enters the customer center, in one transaction with the reply marked as pushed — so the same reply
 * can never create two customers. A company already there (same address, phone or domain) gets the reply under its
 * record and its owner is alerted; otherwise a new customer is created from the radar data and the reply, as
 * 主动开发 with the reply date as its inquiry date, and assigned the way every automatic lead is.
 */
export async function pushReplyToBos(replyId: string) {
  const reply = await db.radarReply.findUniqueOrThrow({ where: { id: replyId }, include: { prospect: true, mailbox: true, send: true, sequence: true } });
  const x = (reply.extracted ?? {}) as Extracted;
  const referral = reply.category === 'REFERRAL' ? canonicalEmail(x.email) : null;
  const email = referral ?? reply.fromAddress;
  const phones = [canonicalPhone(x.whatsapp, undefined, true), canonicalPhone(x.phone, reply.prospect.country), reply.prospect.phoneE164, canonicalPhone(reply.prospect.whatsapp, undefined, true)]
    .filter((p): p is string => !!p);
  return retryTransaction(() => db.$transaction(async tx => {
    await lockIdentity(tx);
    const claim = await tx.radarReply.updateMany({ where: { id: replyId, pushStatus: { in: ['PENDING', 'FAILED'] } }, data: { pushStatus: 'PUSHED', pushedAt: new Date(), pushError: '' } });
    if (!claim.count) return { status: 'ALREADY' as const, customerId: reply.customerId };
    const actor = await intakeAdmin(tx);
    const existing = reply.prospect.customerId
      ? await tx.customer.findFirst({ where: { id: reply.prospect.customerId, deletedAt: null }, select: { id: true, name: true, companyName: true, ownerId: true } })
      : await findBosCustomer({ emails: [email, reply.fromAddress], phones, domain: reply.prospect.domain }, tx);
    let customerId: string;
    if (existing) {
      customerId = existing.id;
      const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { notes: true, updatedAt: true } });
      await tx.customer.update({ where: { id: customerId }, data: { notes: [c.notes, noteBlock(reply)].filter(Boolean).join('\n\n').slice(-60_000), updatedAt: c.updatedAt } });
      await queueLeadAlert(tx, customerId, 'EMAIL_REPLY', existing.ownerId);
    } else {
      const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { currency: true } });
      const intake = await resolveIntakeOwner(tx);
      const quantity = Number.parseInt((x.quantity ?? '').replace(/[^\d]/g, ''), 10);
      const customer = await tx.customer.create({ data: {
        name: (x.contactName || reply.fromName || reply.prospect.name).slice(0, 191), companyName: reply.prospect.name.slice(0, 191),
        country: countryName(reply.prospect.country), countryCode: reply.prospect.country, city: reply.prospect.city.slice(0, 191),
        email, phone: (x.phone || reply.prospect.phone).slice(0, 191), whatsapp: (x.whatsapp || reply.prospect.whatsapp).slice(0, 191),
        source: 'OUTBOUND', sourceDetail: `客户雷达 · 开发信${reply.send ? ` · ${reply.send.templateCode} · 第 ${reply.send.step} 封` : ''}`.slice(0, 191),
        language: reply.sequence?.language ?? '', purchaseType: PURCHASE_TYPE[reply.prospect.customerType] ?? 'OTHER',
        productInterest: (x.products || reply.prospect.mainProducts).slice(0, 191), quantity: Number.isFinite(quantity) && quantity > 0 && quantity < 1_000_000 ? quantity : null,
        purchaseTimeline: (x.timeline ?? '').slice(0, 191), stage: 'REPLIED', stageSource: 'SYSTEM', isQualified: true,
        ownerId: intake.ownerId, currency: settings.currency, inquiryAt: reply.receivedAt, firstReplyAt: reply.receivedAt,
        notes: [`客户雷达：${CUSTOMER_TYPES[reply.prospect.customerType as keyof typeof CUSTOMER_TYPES] ?? ''} · ${reply.prospect.grade} 级 ${reply.prospect.score ?? ''} 分 · 官网 ${reply.prospect.website || '—'}`,
          referral ? `转介绍：原联系邮箱 ${reply.fromAddress}` : '', noteBlock(reply)].filter(Boolean).join('\n'),
      } });
      customerId = customer.id;
      await tx.stageHistory.create({ data: { customerId, toStage: 'REPLIED', changedBy: actor.id, note: '客户雷达 · 开发信回复' } });
      await rememberCustomerContacts(tx, customerId, 'RADAR');
      await enterIntake(tx, customerId, actor.id, intake, '客户雷达');
    }
    await tx.followUp.create({ data: { customerId, type: 'EMAIL', content: followUpText(reply), followUpAt: reply.receivedAt, createdBy: actor.id } });
    await tx.radarReply.update({ where: { id: replyId }, data: { customerId } });
    await tx.radarProspect.update({ where: { id: reply.prospectId }, data: { status: 'IN_BOS', statusAt: new Date(), customerId } });
    if (reply.prospect.domain) await suppress(tx, { scope: 'DOMAIN', value: reply.prospect.domain, reason: 'CUSTOMER', note: '有效回复已推进 BOS' });
    else await suppress(tx, { scope: 'EMAIL', value: reply.fromAddress, reason: 'CUSTOMER', note: '有效回复已推进 BOS' });
    return { status: existing ? 'ATTACHED' as const : 'CREATED' as const, customerId };
  }));
}

/**
 * A later mail from a company already in the customer center: no analysis, straight under the customer with an alert
 * for its owner (docs §7.3, "客户之后在同一线程里再回信，直接转进 BOS").
 */
export async function attachReplyToCustomer(replyId: string) {
  const reply = await db.radarReply.findUniqueOrThrow({ where: { id: replyId }, include: { prospect: true, mailbox: true, send: true, sequence: true } });
  if (!reply.prospect.customerId) return null;
  return retryTransaction(() => db.$transaction(async tx => {
    const claim = await tx.radarReply.updateMany({ where: { id: replyId, pushStatus: { in: ['NONE', 'PENDING', 'FAILED'] } }, data: { pushStatus: 'ATTACHED', pushedAt: new Date(), customerId: reply.prospect.customerId } });
    if (!claim.count) return null;
    const customer = await tx.customer.findFirst({ where: { id: reply.prospect.customerId!, deletedAt: null }, select: { id: true, ownerId: true, notes: true, updatedAt: true } });
    if (!customer) return null;
    const actor = await intakeAdmin(tx);
    await tx.customer.update({ where: { id: customer.id }, data: { notes: [customer.notes, noteBlock(reply)].filter(Boolean).join('\n\n').slice(-60_000), updatedAt: customer.updatedAt } });
    await tx.followUp.create({ data: { customerId: customer.id, type: 'EMAIL', content: `开发信线程里客户又来信：${reply.text.replace(/\s+/g, ' ')}`.slice(0, 191), followUpAt: reply.receivedAt, createdBy: actor.id } });
    await queueLeadAlert(tx, customer.id, 'EMAIL_REPLY', customer.ownerId);
    return customer.id;
  }));
}
