import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { canonicalPhone, canonicalEmail } from '@/lib/contact-identity';
import { customerSchema, dealSchema, followSchema, dealPatchSchema, reasonSchema, followPatchSchema, reasonRequiredStages } from '@/lib/validation';
import { localDate, dayKey } from '@/lib/time';
import { inquiryDate, parseInquiryDate } from '@/lib/customer-date';
import { normalizeWhatsApp } from '@/lib/whatsapp';
import { retryTransaction } from '@/lib/transaction-retry';
import { qualifiedFeedback } from './advertising-feedback-service';
import { ensureOrderForDeal, syncOrderForDeal, cancelOrderInTx } from './order-service';
import { lockCustomer, lockIdentity, rememberCustomerContacts } from './contact-identity-service';

export const normalizePhone = normalizeWhatsApp;

type Tx = Prisma.TransactionClient;
type ContactInput = { email?: string | null; phone?: string | null; whatsapp?: string | null; countryCode?: string | null };
export type DuplicateCustomer = {
  id: string; name: string; email: string; phone: string; whatsapp: string;
  ownerId: string; ownerName: string; pendingAssignment: boolean;
};

const workflow = () => import('./workflow-service');

function contactKeys(input: ContactInput) {
  const email = canonicalEmail(input.email);
  const phones = [canonicalPhone(input.phone, input.countryCode), canonicalPhone(input.whatsapp, undefined, true)]
    .filter((value): value is string => !!value);
  return { email, phones };
}

/**
 * Possible duplicates by canonical email or phone, including historical aliases.
 * Uses the indexed keys; only customers whose keys were never computed are compared in memory.
 */
export async function duplicates(input: ContactInput, exclude?: string, client: Tx = db): Promise<DuplicateCustomer[]> {
  const { email, phones } = contactKeys(input);
  if (!email && !phones.length) return [];
  const identityFilters: Prisma.ContactIdentityWhereInput[] = [
    ...(email ? [{ kind: 'EMAIL', normalized: email }] : []),
    ...(phones.length ? [{ kind: 'PHONE', normalized: { in: phones } }] : []),
  ];
  const keyFilters: Prisma.CustomerWhereInput[] = [
    ...(email ? [{ emailNormalized: email }] : []),
    ...(phones.length ? [{ phoneE164: { in: phones } }] : []),
  ];
  const aliases = await client.contactIdentity.findMany({ where: { OR: identityFilters }, select: { customerId: true } });
  const keyed = await client.customer.findMany({ where: { OR: keyFilters }, select: { id: true } });
  const legacy = await client.customer.findMany({
    where: { contactKeysAt: null, deletedAt: null, OR: [{ phone: { not: '' } }, { whatsapp: { not: '' } }, { email: { not: '' } }] },
    select: { id: true, email: true, phone: true, whatsapp: true, countryCode: true },
  });
  const legacyMatches = legacy.filter(c => {
    const keys = contactKeys(c);
    return (email && keys.email === email) || keys.phones.some(phone => phones.includes(phone));
  });
  const ids = new Set([...aliases.map(a => a.customerId), ...keyed.map(c => c.id), ...legacyMatches.map(c => c.id)]);
  if (exclude) ids.delete(exclude);
  if (!ids.size) return [];
  const rows = await client.customer.findMany({
    where: { id: { in: [...ids] }, deletedAt: null },
    select: { id: true, name: true, email: true, phone: true, whatsapp: true, ownerId: true, pendingAssignment: true, owner: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(({ owner, ...row }) => ({ ...row, ownerName: owner.name }));
}

/**
 * Administrators see the matching customers and may deliberately keep both records.
 * Salespeople only see their own matches and who holds the others, so a conflict can be escalated.
 */
function duplicateError(dup: DuplicateCustomer[], user: Actor) {
  if (user.role === 'ADMIN') return new HttpError(409, '发现可能重复客户', { potentialDuplicate: true, canForce: true, customers: dup });
  const own = dup.filter(d => d.ownerId === user.id && !d.pendingAssignment);
  const holders = [...new Set(dup.filter(d => !own.includes(d)).map(d => d.pendingAssignment ? '待分配池' : `${d.ownerName}`))];
  const message = holders.length
    ? `该联系方式已登记在${holders.join('、')}的客户中，不能重复创建。请联系管理员核对归属，需要时由管理员转交给你。`
    : '该联系方式已在你负责的客户中，请直接打开已有客户继续跟进。';
  return new HttpError(409, message, { potentialDuplicate: true, canForce: false, customers: own, holders });
}

export async function accessible(id: string, user: Actor) {
  const c = await db.customer.findFirst({ where: { id, ...scope(user) }, include: { deals: true } });
  if (!c) throw new HttpError(404, '客户不存在或无访问权限');
  return c;
}

type SaveOptions = {
  onSaved?: (tx: Tx, customerId: string) => Promise<void>;
  /** Automatically received lead: the owner comes from the assignment rules, not from the input. */
  intake?: { channel: string; preferredOwnerEmail?: string | null };
};

export async function saveCustomer(input: unknown, user: Actor, id?: string, options: SaveOptions = {}) {
  const v = customerSchema.parse(input);
  const admin = user.role === 'ADMIN';
  const old = id ? await accessible(id, user) : null;
  if (old && v.expectedUpdatedAt && old.updatedAt.getTime() !== new Date(v.expectedUpdatedAt).getTime()) {
    throw new HttpError(409, '客户资料已被其他人修改，请刷新后再保存');
  }
  if (v.stage === 'WON' && !old?.deals.length) throw new HttpError(400, '请先保存客户，再通过新增成交订单进入已成交');
  if (old?.deals.length && v.stage !== 'WON') throw new HttpError(400, '已有成交订单的客户保留已成交阶段');
  if (!admin && v.ownerId !== user.id) throw new HttpError(403, '只能管理自己的客户');
  if (old && !admin) {
    // Where and when a lead came from drives attribution and the salesperson's own metrics.
    v.inquiryAt = undefined;
    v.source = old.source as typeof v.source;
    v.sourceDetail = old.sourceDetail;
  }
  if (!await db.user.findFirst({ where: { id: v.ownerId, ...(old?.ownerId === v.ownerId ? {} : { isActive: true }) } })) {
    throw new HttpError(400, '负责人不存在或账号已停用');
  }
  const stageChanged = !old || old.stage !== v.stage;
  if (stageChanged && reasonRequiredStages.includes(v.stage) && !v.invalidReason.trim()) {
    throw new HttpError(400, '标记为暂不需要、已流失或无效客户时，请填写原因');
  }

  // Duplicate checks only look at contact keys this save introduces, so legacy duplicates never block editing other fields.
  const before = old ? contactKeys(old) : { email: null, phones: [] as string[] };
  const phoneKey = canonicalPhone(v.phone, v.countryCode), whatsappKey = canonicalPhone(v.whatsapp, undefined, true);
  const newContacts: ContactInput = {
    email: contactKeys({ email: v.email }).email && contactKeys({ email: v.email }).email !== before.email ? v.email : '',
    phone: phoneKey && !before.phones.includes(phoneKey) ? v.phone : '',
    whatsapp: whatsappKey && !before.phones.includes(whatsappKey) ? v.whatsapp : '',
    countryCode: v.countryCode,
  };
  const contactsChanged = !old || old.phone.trim() !== v.phone.trim() || old.whatsapp.trim() !== v.whatsapp.trim()
    || old.email.trim().toLowerCase() !== v.email.trim().toLowerCase() || old.countryCode.trim() !== v.countryCode.trim();
  const identityChange = contactsChanged || !old?.contactKeysAt;
  const forced = admin && v.forceDuplicate === true;
  const dup = await duplicates(newContacts, id);
  if (dup.length && !forced) throw duplicateError(dup, user);

  const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  let effectiveInquiry: Date;
  try {
    effectiveInquiry = v.inquiryAt === undefined ? (old ? inquiryDate(old) : new Date()) : parseInquiryDate(v.inquiryAt, settings.timezone);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  // A date-only edit of the same day preserves legacy precision and attribution.
  if (old && v.inquiryAt === dayKey(inquiryDate(old), settings.timezone)) effectiveInquiry = inquiryDate(old);
  if (old && effectiveInquiry.getTime() !== inquiryDate(old).getTime()) {
    const earliestFollow = await db.followUp.findFirst({ where: { customerId: old.id }, orderBy: { followUpAt: 'asc' } });
    const events = [old.contactedAt, old.firstReplyAt, old.needsConfirmedAt, old.quotedAt, old.wonAt, earliestFollow?.followUpAt, ...old.deals.map(d => d.dealDate)]
      .filter((d): d is Date => !!d);
    if (events.some(d => dayKey(effectiveInquiry, settings.timezone) > dayKey(d, settings.timezone))) {
      throw new HttpError(400, '询盘日期不能晚于已有联系、报价、跟进或成交日期，请先核对历史记录');
    }
  }

  const { forceDuplicate: ignoredForce, expectedUpdatedAt: ignoredVersion, nextFollowUpAt, inquiryAt: ignoredInquiry, ...fields } = v;
  void ignoredForce; void ignoredVersion; void ignoredInquiry;
  const data: Prisma.CustomerUncheckedCreateInput = {
    ...fields,
    stageSource: 'HUMAN',
    whatsappNormalized: normalizeWhatsApp(v.whatsapp),
    inquiryAt: effectiveInquiry,
    email: v.email.trim().toLowerCase(),
    isQualified: v.stage === 'INVALID' ? false : v.isQualified,
    nextFollowUpAt: nextFollowUpAt ? localDate(nextFollowUpAt, settings.timezone) : null,
  };
  const stamp = { CONTACTED: 'contactedAt', REPLIED: 'firstReplyAt', NEEDS_CONFIRMED: 'needsConfirmedAt', QUOTED: 'quotedAt', LOST: 'lostAt' } as const;
  const field = stamp[v.stage as keyof typeof stamp];
  if (field && !old?.[field]) data[field] = new Date();

  const saved = await retryTransaction(() => db.$transaction(async tx => {
    // Only saves that add or change contact identities need the global identity lock.
    if (identityChange) await lockIdentity(tx); else await lockCustomer(tx, old!.id);
    if (old) {
      const fresh = await tx.customer.findFirst({ where: { id: old.id, ...scope(user) } });
      if (!fresh || fresh.updatedAt.getTime() !== old.updatedAt.getTime()) throw new HttpError(409, '客户已被修改，请刷新后重试');
    }
    if (identityChange) {
      const rechecked = await duplicates(newContacts, id, tx);
      if (rechecked.length && !forced) throw duplicateError(rechecked, user);
      if (id) await rememberCustomerContacts(tx, id, 'CUSTOMER_EDIT');
    }
    const lead = !old && options.intake;
    const intake = lead ? await (await import('./lead-assignment-service')).resolveIntakeOwner(tx, options.intake!.preferredOwnerEmail) : null;
    if (intake) data.ownerId = intake.ownerId;
    const c = id ? await tx.customer.update({ where: { id }, data }) : await tx.customer.create({ data });
    if (stageChanged) {
      const note = reasonRequiredStages.includes(v.stage) ? v.invalidReason.trim().slice(0, 190) : '';
      await tx.stageHistory.create({ data: { customerId: c.id, fromStage: old?.stage, toStage: v.stage, changedBy: user.id, note } });
    }
    if (identityChange) await rememberCustomerContacts(tx, c.id, 'CUSTOMER_EDIT');
    const flow = await workflow();
    if (intake) await (await import('./lead-assignment-service')).enterIntake(tx, c.id, user.id, intake, options.intake!.channel);
    else if (!old) await flow.initializeFirstContact(tx, c.id, user.id, null);
    else if (old.ownerId !== c.ownerId) {
      await flow.initializeFirstContact(tx, c.id, user.id, old.ownerId, old.pendingAssignment ? '管理员从待分配池分配' : '管理员转交客户');
    }
    if (v.stage === 'CONTACTED' && !old?.contactedAt) await flow.recordFirstContact(tx, c.id, c.contactedAt || new Date(), user.id);
    if (options.onSaved) await options.onSaved(tx, c.id);
    if (c.isQualified === true) await qualifiedFeedback(tx, c.id, new Date());
    return c;
  }));
  await (await workflow()).syncCustomerWorkflow(saved.id);
  return saved;
}

/** Soft delete. Customers with deals stay: their revenue would silently disappear from every statistic. */
export async function deleteCustomer(id: string, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '需要管理员权限');
  const c = await accessible(id, user);
  if (c.deals.length || c.stage === 'WON') throw new HttpError(409, '已成交客户不能删除。如成交录入有误，请先在客户档案中作废成交。');
  await db.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  await (await workflow()).syncCustomerWorkflow(id);
  return { deleted: true };
}

/** Latest follow-up drives the customer's last / next follow-up dates. */
async function refreshFollowUpFacts(tx: Tx, customerId: string) {
  const latest = await tx.followUp.findFirst({ where: { customerId }, orderBy: [{ followUpAt: 'desc' }, { createdAt: 'desc' }] });
  await tx.customer.update({
    where: { id: customerId },
    data: latest ? { lastFollowUpAt: latest.followUpAt, nextFollowUpAt: latest.nextFollowUpAt } : { lastFollowUpAt: null },
  });
}

export async function addFollowUp(id: string, input: unknown, user: Actor) {
  const c = await accessible(id, user);
  const v = followSchema.parse(input);
  const s = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const followUpAt = localDate(v.followUpAt, s.timezone);
  const nextFollowUpAt = v.nextFollowUpAt ? localDate(v.nextFollowUpAt, s.timezone) : null;
  if (followUpAt > new Date()) throw new HttpError(400, '跟进时间不能晚于当前时间');
  if (dayKey(followUpAt, s.timezone) < dayKey(inquiryDate(c), s.timezone)) {
    throw new HttpError(400, '跟进日期不能早于询盘日期，请先核对客户的实际询盘日期');
  }
  const saved = await retryTransaction(() => db.$transaction(async tx => {
    await lockCustomer(tx, id);
    if (!await tx.customer.findFirst({ where: { id, ...scope(user) } })) throw new HttpError(404, '客户不存在或无访问权限');
    const f = await tx.followUp.create({ data: { ...v, customerId: id, createdBy: user.id, followUpAt, nextFollowUpAt } });
    await refreshFollowUpFacts(tx, id);
    // A recorded follow-up is a real contact, even when the conversation happened outside the system.
    await tx.customer.updateMany({ where: { id, OR: [{ lastContactAt: null }, { lastContactAt: { lt: followUpAt } }] }, data: { lastContactAt: followUpAt } });
    const flow = await workflow();
    await flow.recordFirstContact(tx, id, followUpAt, user.id);
    await flow.resolveContactRequests(tx, id);
    return f;
  }));
  await (await workflow()).syncCustomerWorkflow(id);
  return saved;
}

async function followUpFor(customerId: string, followUpId: string, user: Actor) {
  await accessible(customerId, user);
  const follow = await db.followUp.findFirst({ where: { id: followUpId, customerId } });
  if (!follow) throw new HttpError(404, '跟进记录不存在');
  return follow;
}

/** The author or an administrator corrects the wording; the contact time stays a fact. */
export async function updateFollowUp(customerId: string, followUpId: string, input: unknown, user: Actor) {
  const follow = await followUpFor(customerId, followUpId, user);
  if (user.role !== 'ADMIN' && follow.createdBy !== user.id) throw new HttpError(403, '只能修改自己记录的跟进');
  const v = followPatchSchema.parse(input);
  return db.$transaction(async tx => {
    const updated = await tx.followUp.update({ where: { id: followUpId }, data: v });
    await tx.identityAudit.create({ data: { entityType: 'FOLLOW_UP', entityId: followUpId, fromCustomerId: customerId, toCustomerId: customerId, actorId: user.id,
      reason: '更正跟进内容', detail: { before: { type: follow.type, content: follow.content } } } });
    return updated;
  });
}

export async function deleteFollowUp(customerId: string, followUpId: string, input: unknown, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '只有管理员可以删除跟进记录');
  const follow = await followUpFor(customerId, followUpId, user);
  const { reason } = reasonSchema.parse(input);
  await retryTransaction(() => db.$transaction(async tx => {
    await lockCustomer(tx, customerId);
    await tx.followUp.delete({ where: { id: followUpId } });
    await refreshFollowUpFacts(tx, customerId);
    await tx.identityAudit.create({ data: { entityType: 'FOLLOW_UP', entityId: followUpId, fromCustomerId: customerId, actorId: user.id, reason,
      detail: { action: 'DELETED', before: { ...follow, followUpAt: follow.followUpAt.toISOString(), nextFollowUpAt: follow.nextFollowUpAt?.toISOString() ?? null, createdAt: follow.createdAt.toISOString() } } } });
  }));
  await (await workflow()).syncCustomerWorkflow(customerId);
  return { deleted: true };
}

async function validDealDate(value: string, customer: { inquiryAt: Date | null; createdAt: Date }) {
  const s = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const dealDate = localDate(value, s.timezone);
  if (dealDate > new Date()) throw new HttpError(400, '成交日期不能在未来');
  if (dayKey(dealDate, s.timezone) < dayKey(inquiryDate(customer), s.timezone)) {
    throw new HttpError(400, '成交日期不能早于询盘日期，请先核对客户的实际询盘日期');
  }
  return dealDate;
}

export async function addDeal(id: string, input: unknown, user: Actor) {
  const customer = await accessible(id, user);
  const v = dealSchema.parse(input);
  const dealDate = await validDealDate(v.dealDate, customer);
  const revenue = new Prisma.Decimal(v.dealAmount), cost = new Prisma.Decimal(v.productCost), profit = revenue.minus(cost);
  const deal = await retryTransaction(() => db.$transaction(async tx => {
    // Order numbers are sequential per day, so deal creation keeps the global lock.
    await lockIdentity(tx);
    const c = await tx.customer.findFirst({ where: { id, ...scope(user) } });
    if (!c) throw new HttpError(404, '客户不存在或无访问权限');
    const deal = await tx.deal.create({ data: { ...v, customerId: id, salespersonId: c.ownerId, dealDate, grossProfit: profit, grossMargin: profit.div(revenue) } });
    await tx.customer.update({ where: { id }, data: { stage: 'WON', stageSource: 'SYSTEM', isQualified: true, invalidReason: '', wonAt: c.wonAt ?? dealDate } });
    if (c.stage !== 'WON') await tx.stageHistory.create({ data: { customerId: id, fromStage: c.stage, toStage: 'WON', changedBy: user.id, note: '新增成交订单' } });
    // 客户成交即产生订单：同一事务内建单，按 dealId 幂等，复购会生成新订单
    await qualifiedFeedback(tx, id, dealDate);
    await ensureOrderForDeal(tx, { dealId: deal.id, customerId: id, amount: revenue, currency: v.currency, orderDate: dealDate, createdBy: user.id });
    return deal;
  }));
  await (await workflow()).syncCustomerWorkflow(id);
  return deal;
}

const dealSnapshot = (deal: { dealAmount: Prisma.Decimal; productCost: Prisma.Decimal; currency: string; dealDate: Date; orderNumber: string; product: string; quantity: number; notes: string }) => ({
  dealAmount: deal.dealAmount.toFixed(2), productCost: deal.productCost.toFixed(2), currency: deal.currency, dealDate: deal.dealDate.toISOString(),
  orderNumber: deal.orderNumber, product: deal.product, quantity: deal.quantity, notes: deal.notes,
});

async function refreshWonAt(tx: Tx, customerId: string) {
  const first = await tx.deal.findFirst({ where: { customerId }, orderBy: { dealDate: 'asc' }, select: { dealDate: true } });
  await tx.customer.update({ where: { id: customerId }, data: { wonAt: first?.dealDate ?? null } });
}

/** Administrators correct amount, cost, date or currency; profit and the linked order follow. */
export async function updateDeal(customerId: string, dealId: string, input: unknown, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '只有管理员可以修改成交');
  const customer = await accessible(customerId, user);
  const { expectedUpdatedAt, ...v } = dealPatchSchema.parse(input);
  const dealDate = await validDealDate(v.dealDate, customer);
  const revenue = new Prisma.Decimal(v.dealAmount), cost = new Prisma.Decimal(v.productCost), profit = revenue.minus(cost);
  return retryTransaction(() => db.$transaction(async tx => {
    await lockCustomer(tx, customerId);
    const before = await tx.deal.findFirst({ where: { id: dealId, customerId } });
    if (!before) throw new HttpError(404, '成交记录不存在');
    if (before.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) throw new HttpError(409, '成交记录已被其他人修改，请刷新后重试');
    const deal = await tx.deal.update({ where: { id: dealId }, data: { ...v, dealDate, grossProfit: profit, grossMargin: profit.div(revenue) } });
    await syncOrderForDeal(tx, deal);
    await refreshWonAt(tx, customerId);
    await tx.identityAudit.create({ data: { entityType: 'DEAL', entityId: dealId, fromCustomerId: customerId, toCustomerId: customerId, actorId: user.id,
      reason: '更正成交信息', detail: { before: dealSnapshot(before), after: dealSnapshot(deal) } } });
    return deal;
  }));
}

/**
 * Voiding removes a mistaken or cancelled deal from revenue: the linked order is cancelled (its ad Purchase
 * event is then never sent) and a customer without other deals returns to the stage before it was won.
 */
export async function voidDeal(customerId: string, dealId: string, input: unknown, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '只有管理员可以作废成交');
  await accessible(customerId, user);
  const { reason } = reasonSchema.parse(input);
  await retryTransaction(() => db.$transaction(async tx => {
    await lockCustomer(tx, customerId);
    const deal = await tx.deal.findFirst({ where: { id: dealId, customerId } });
    if (!deal) throw new HttpError(404, '成交记录不存在');
    const order = await tx.order.findUnique({ where: { dealId }, select: { id: true, orderNo: true, status: true } });
    if (order && order.status !== 'CANCELLED') await cancelOrderInTx(tx, order.id);
    await tx.deal.delete({ where: { id: dealId } });
    const remaining = await tx.deal.count({ where: { customerId } });
    const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (!remaining && c.stage === 'WON') {
      const won = await tx.stageHistory.findFirst({ where: { customerId, toStage: 'WON' }, orderBy: { changedAt: 'desc' } });
      const back = won?.fromStage && won.fromStage !== 'WON' ? won.fromStage : 'ORDER';
      await tx.customer.update({ where: { id: customerId }, data: { stage: back, stageSource: 'HUMAN' } });
      await tx.stageHistory.create({ data: { customerId, fromStage: 'WON', toStage: back, changedBy: user.id, note: `作废成交：${reason}`.slice(0, 190) } });
    }
    await refreshWonAt(tx, customerId);
    await tx.identityAudit.create({ data: { entityType: 'DEAL', entityId: dealId, fromCustomerId: customerId, actorId: user.id, reason,
      detail: { action: 'VOIDED', orderNo: order?.orderNo ?? null, before: dealSnapshot(deal) } } });
  }));
  await (await workflow()).syncCustomerWorkflow(customerId);
  return { voided: true };
}
