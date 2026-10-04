import { existsSync } from 'node:fs';
import { db } from '../lib/db';
import { ensureOrderForDeal } from '../services/order-service';

// 本机开发时读 .env；生产环境没有 .env，环境变量由平台注入。
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL：无法连接数据库。请在环境中配置后重试。');
  process.exit(1);
}

/**
 * 为「已成交但还没有订单」的历史成交补齐订单。
 *
 * 订单在新增成交时就会自动创建；这个脚本只是把启用订单模块之前已经存在的成交
 * 补上，让订单页一打开就有真实数据，而不是空表。
 * 按 dealId 幂等：重复运行不会产生第二张订单。
 */
async function main() {
  const deals = await db.deal.findMany({
    where: { order: null },
    select: { id: true, customerId: true, dealAmount: true, currency: true, dealDate: true, customer: { select: { ownerId: true } } },
    orderBy: { dealDate: 'asc' },
  });

  if (!deals.length) {
    console.log(`订单：无需补单，当前共 ${await db.order.count()} 张订单。`);
    return;
  }

  let created = 0;
  for (const deal of deals) {
    const order = await db.$transaction(tx =>
      ensureOrderForDeal(tx, {
        dealId: deal.id,
        customerId: deal.customerId,
        amount: deal.dealAmount,
        currency: deal.currency,
        orderDate: deal.dealDate,
        createdBy: deal.customer.ownerId,
        historical: true,
      }),
    );
    if (order) created += 1;
  }
  console.log(`订单：为 ${created} 笔历史成交补齐了订单，当前共 ${await db.order.count()} 张订单。`);
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
