// Plain strings, safe to import from client components (lib/metrics.ts pulls in Prisma).
/** How each number is counted, in the words pages show next to it. */
export const METRIC_NOTES = {
  newInquiries: '新增询盘：按询盘日期统计（没有询盘日期时按建档日期），包括待分配的客户，每位客户只计一次。',
  qualified: '有效客户：没有被判为无效，并且标记为有效（客户到了已回复及之后的阶段会自动标记），或者已经推进到报价、跟进、确认采购或成交。',
  revenue: '成交额与毛利：按成交日期统计，不含回收站客户，不同币种分开统计、不换算。',
  orders: '订单：按下单日期统计，不含已取消的订单。',
  quotes: '报价：只算已发送的报价，按发送日期统计。',
} as const;
