import { Prisma } from '@prisma/client';

/**
 * 一份报价的金额（统计「报价金额」与客户「报价金额」的唯一口径）。
 *   - 多行报价单：totalAmount（产品小计 + 运费 + 其他费用，即客户看到的报价总额）
 *   - 旧的单行报价：unitPrice × quantity
 */
export function quotationAmount(q: { totalAmount?: Prisma.Decimal | null; unitPrice: Prisma.Decimal; quantity: number }): Prisma.Decimal {
  return q.totalAmount ?? q.unitPrice.mul(q.quantity);
}

/** 读取报价金额时需要一并 select 的字段。 */
export const quotationAmountSelect = { totalAmount: true, unitPrice: true, quantity: true } as const;
