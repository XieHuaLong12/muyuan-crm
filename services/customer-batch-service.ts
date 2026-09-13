import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';

const batchSchema = z.object({ ids: z.array(z.string().min(1)).min(1, '请选择客户').max(200, '单次最多选择200位客户') });

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
