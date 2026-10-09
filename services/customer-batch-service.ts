import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';

const batchSchema = z.object({ ids: z.array(z.string().min(1)).min(1, '请选择客户').max(200, '单次最多选择200位客户') });
const purgeSchema = z.object({ ids: z.array(z.string().min(1)).min(1, '请选择客户').max(500, '单次最多彻底删除500位客户') });

export async function batchCustomers(input: unknown, user: Actor, restore = false) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '只有管理员可以删除或恢复客户');
  const ids = [...new Set(batchSchema.parse(input).ids)];
  return db.$transaction(async tx => {
    const records = await tx.customer.findMany({
      where: { id: { in: ids }, deletedAt: restore ? { not: null } : null },
      include: { _count: { select: { deals: true } } },
    });
    if (records.length !== ids.length) throw new HttpError(409, '部分客户状态已变化，请刷新后重新选择');
    if (!restore && records.some(c => c._count.deals > 0 || c.stage === 'WON')) {
      throw new HttpError(409, '所选客户包含已成交客户，未删除任何记录。请取消选择已成交客户。');
    }
    const result = await tx.customer.updateMany({
      where: { id: { in: ids }, deletedAt: restore ? { not: null } : null, ...(!restore ? { deals: { none: {} }, stage: { not: 'WON' } } : {}) },
      data: { deletedAt: restore ? null : new Date() },
    });
    if (result.count !== ids.length) throw new HttpError(409, '客户状态已变化，本次操作已取消');
    return { count: result.count, action: restore ? 'restored' : 'deleted' };
  });
}
/**
 * Permanently removes customers from the recycle bin. Business history that other modules rely on
 * (deals, orders, WhatsApp messages, sent quotes, delivered ad feedback) blocks the purge with a
 * per-customer reason. Lead and WhatsApp identities are unlinked so a later import can claim them again.
 */
export async function purgeCustomers(input: unknown, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '只有管理员可以彻底删除客户');
  const ids = [...new Set(purgeSchema.parse(input).ids)];
  return db.$transaction(async tx => {
    const records = await tx.customer.findMany({
      where: { id: { in: ids }, deletedAt: { not: null } },
      select: { id: true, name: true, _count: { select: { deals: true, orders: true, whatsappMessages: true } },
        quotations: { where: { status: 'SENT' }, select: { id: true }, take: 1 },
        advertisingFeedback: { where: { status: { in: ['SENT', 'PROCESSING'] } }, select: { id: true }, take: 1 } },
    });
    if (records.length !== ids.length) throw new HttpError(409, '部分客户不在回收站，请刷新后重新选择');
    const blocked = records.flatMap(c => {
      const reasons = [
        c._count.deals || c._count.orders ? '有成交或订单' : '',
        c._count.whatsappMessages ? '有 WhatsApp 沟通记录' : '',
        c.quotations.length ? '有已发送报价' : '',
        c.advertisingFeedback.length ? '已向广告平台回传事件' : '',
      ].filter(Boolean);
      return reasons.length ? [{ id: c.id, name: c.name, reasons }] : [];
    });
    if (blocked.length) {
      throw new HttpError(409, `以下客户保留了业务记录，不能彻底删除（可继续留在回收站）：${blocked.map(b => `${b.name}（${b.reasons.join('、')}）`).join('；')}`, { blocked });
    }
    const where = { customerId: { in: ids } };
    await tx.customerLeadAttribution.updateMany({ where, data: { customerId: null, status: 'UNMATCHED', matchMethod: 'NONE', confidence: 0 } });
    await tx.whatsAppContact.updateMany({ where, data: { customerId: null, status: 'UNMATCHED', matchMethod: 'NONE', confidence: 0 } });
    await tx.advertisingFeedback.deleteMany({ where });
    await tx.contactIdentity.deleteMany({ where });
    await tx.customerIntelligence.deleteMany({ where });
    await tx.leadSubmission.deleteMany({ where });
    await tx.followUp.deleteMany({ where });
    await tx.stageHistory.deleteMany({ where });
    // Tasks, reminders, read states, assignments, draft quotes, workflow events and media rows cascade.
    const result = await tx.customer.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null } } });
    if (result.count !== ids.length) throw new HttpError(409, '客户状态发生变化，本次操作已取消');
    return { count: result.count, action: 'purged' };
  }, { timeout: 30000 });
}
