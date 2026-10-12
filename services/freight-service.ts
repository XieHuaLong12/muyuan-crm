import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { FREIGHT_BASES, FREIGHT_MODES, QUOTE_CURRENCIES, QUOTE_INCOTERMS } from '@/lib/quote-math';

/**
 * 运费库：按目的国维护运价，报价时按总毛重 / 总体积自动算运费。
 * 读：所有登录用户（报价要用）；写：仅管理员（运价是公司统一口径）。
 * 运价修改不影响已保存的报价单：报价单保存的是当时的运费计算快照。
 */

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(value => (value === '' || value === undefined ? null : value), schema.nullable()).default(null);

export const freightRateInput = z.object({
  country: z.string().trim().min(1, '请填写目的国').max(80, '目的国最多 80 个字'),
  port: z.string().trim().max(120, '目的港 / 城市最多 120 个字').default(''),
  mode: z.enum(FREIGHT_MODES, { errorMap: () => ({ message: '请选择运输方式' }) }),
  incoterm: z.enum(QUOTE_INCOTERMS, { errorMap: () => ({ message: '请选择贸易条款' }) }),
  basis: z.enum(FREIGHT_BASES, { errorMap: () => ({ message: '请选择计费方式' }) }),
  rate: z.coerce.number({ invalid_type_error: '请填写运价' }).positive('运价必须大于 0').max(10_000_000, '运价过大'),
  currency: z.enum(QUOTE_CURRENCIES, { errorMap: () => ({ message: '请选择运价币种' }) }),
  volumetricKgPerCbm: optionalNumber(z.coerce.number().int('计泡系数必须是整数').min(1, '计泡系数至少为 1').max(1000, '计泡系数最多 1000')),
  minChargeQty: optionalNumber(z.coerce.number().min(0, '最低计费量不能为负').max(100_000, '最低计费量过大')),
  transitDays: z.string().trim().max(40, '时效最多 40 个字').default(''),
  note: z.string().trim().max(500, '备注最多 500 个字').default(''),
});

const freightPatchInput = freightRateInput.extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  expectedUpdatedAt: z.string().datetime({ offset: true, message: '缺少版本信息，请刷新后重试' }),
});

const listQuery = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE') });

const ADMIN_ONLY = '只有管理员可以维护运费库';

export type FreightRateView = ReturnType<typeof serialize>;

function serialize(rate: Prisma.FreightRateGetPayload<object>) {
  return {
    id: rate.id,
    country: rate.country,
    port: rate.port,
    mode: rate.mode,
    incoterm: rate.incoterm,
    basis: rate.basis,
    rate: Number(rate.rate.toFixed(2)),
    currency: rate.currency,
    volumetricKgPerCbm: rate.volumetricKgPerCbm,
    minChargeQty: rate.minChargeQty === null ? null : Number(rate.minChargeQty.toFixed(2)),
    transitDays: rate.transitDays,
    note: rate.note,
    status: rate.status,
    updatedAt: rate.updatedAt.toISOString(),
  };
}

function data(v: z.infer<typeof freightRateInput>) {
  return {
    ...v,
    rate: new Prisma.Decimal(v.rate.toFixed(2)),
    minChargeQty: v.minChargeQty === null ? null : new Prisma.Decimal(v.minChargeQty.toFixed(2)),
    // 计泡系数只对按公斤计费有意义
    volumetricKgPerCbm: v.basis === 'KG' ? v.volumetricKgPerCbm : null,
  };
}

export async function listFreightRates(user: Actor, input: unknown = {}) {
  void user;
  const { status } = listQuery.parse(input);
  const rows = await db.freightRate.findMany({
    where: status === 'ALL' ? {} : { status },
    orderBy: [{ country: 'asc' }, { mode: 'asc' }, { createdAt: 'asc' }],
    take: 500,
  });
  return rows.map(serialize);
}

export async function createFreightRate(user: Actor, input: unknown) {
  requireAdmin(user, ADMIN_ONLY);
  const v = freightRateInput.parse(input);
  const saved = await db.freightRate.create({ data: { ...data(v), createdBy: user.id } });
  return serialize(saved);
}

/** 修改或归档运价；带版本号防止两人同时改同一条。 */
export async function updateFreightRate(user: Actor, id: string, input: unknown) {
  requireAdmin(user, ADMIN_ONLY);
  const { expectedUpdatedAt, status, ...v } = freightPatchInput.parse(input);
  const result = await db.freightRate.updateMany({
    where: { id, updatedAt: new Date(expectedUpdatedAt) },
    data: { ...data(v), status, updatedBy: user.id },
  });
  if (!result.count) {
    const exists = await db.freightRate.count({ where: { id } });
    if (!exists) throw new HttpError(404, '运价不存在');
    throw new HttpError(409, '这条运价刚被其他人修改过，请刷新后再改');
  }
  return serialize(await db.freightRate.findUniqueOrThrow({ where: { id } }));
}
