import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import type { Actor } from '@/lib/auth';
import { CUSTOMER_COLUMN_KEYS, DEFAULT_CUSTOMER_COLUMNS, normalizeCustomerColumns, type CustomerColumnKey } from '@/lib/customer-columns';

/** 客户列表的「定制列」：每位用户一份，只影响本人看到的列表。 */
const CUSTOMER_VIEW = 'customers';

const columnsInput = z.object({
  columns: z.array(
    z.enum(CUSTOMER_COLUMN_KEYS, { errorMap: () => ({ message: '列设置里有不存在的列，请刷新页面后重试' }) }),
    { required_error: '请选择要显示的列', invalid_type_error: '列设置格式不正确' },
  ).min(1, '至少保留一列').max(100, '列设置格式不正确'),
});

export type CustomerColumnView = { columns: CustomerColumnKey[]; custom: boolean };

const customerViewKey = (user: Actor) => ({ userId_view: { userId: user.id, view: CUSTOMER_VIEW } });

/** 本人的客户列表列；没有保存过时是默认列（custom=false），以后调整默认列也会跟着变。 */
export async function customerColumns(user: Actor): Promise<CustomerColumnView> {
  const saved = await db.userViewPreference.findUnique({ where: customerViewKey(user), select: { columns: true } });
  const stored = z.array(z.string()).safeParse(saved?.columns);
  if (!stored.success) return { columns: [...DEFAULT_CUSTOMER_COLUMNS], custom: false };
  return { columns: normalizeCustomerColumns(stored.data), custom: true };
}

export async function saveCustomerColumns(input: unknown, user: Actor): Promise<CustomerColumnView> {
  const columns = normalizeCustomerColumns(columnsInput.parse(input).columns);
  const where = customerViewKey(user);
  try {
    await db.userViewPreference.upsert({ where, create: { userId: user.id, view: CUSTOMER_VIEW, columns }, update: { columns } });
  } catch (error) {
    // 同一个人的两次首次保存同时到达时，后到的一次撞上 (userId, view) 唯一键：改为覆盖。
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    await db.userViewPreference.update({ where, data: { columns } });
  }
  return { columns, custom: true };
}

/** 恢复默认列：删掉本人的设置，之后跟随默认列。 */
export async function resetCustomerColumns(user: Actor): Promise<CustomerColumnView> {
  await db.userViewPreference.deleteMany({ where: { userId: user.id, view: CUSTOMER_VIEW } });
  return { columns: [...DEFAULT_CUSTOMER_COLUMNS], custom: false };
}
