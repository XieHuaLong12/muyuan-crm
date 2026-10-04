import { deleteTestCustomers, deleteTestOrders } from './identity-test-cleanup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { batchCustomers } from '../services/customer-batch-service';
import { HttpError } from '../lib/auth';

test('批量删除/恢复：权限、成交保护、事务回滚、去重与关联记录保留', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: 'ADMIN' };
  const ids: string[] = [];
  try {
    for (const name of ['批量测试A', '批量测试B', '成交保护测试']) {
      const customer = await db.customer.create({ data: { name, ownerId: admin.id, notes: 'batch-test-only' } });
      ids.push(customer.id);
    }
    await db.followUp.create({ data: { customerId: ids[0], type: 'PHONE', content: '保留跟进', followUpAt: new Date(), createdBy: admin.id } });
    await db.deal.create({ data: { customerId: ids[2], dealAmount: 100, productCost: 60, grossProfit: 40, grossMargin: 0.4, dealDate: new Date() } });
    await assert.rejects(batchCustomers({ ids: [ids[0]] }, { ...actor, role: 'SALES' }), (e: unknown) => e instanceof HttpError && e.status === 403);
    await assert.rejects(batchCustomers({ ids: [ids[0], ids[2]] }, actor), /已成交/);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: ids[0] } })).deletedAt, null);
    await assert.rejects(batchCustomers({ ids: [ids[0], 'missing-id'] }, actor), /状态已变化/);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: ids[0] } })).deletedAt, null);
    assert.equal((await batchCustomers({ ids: [ids[0], ids[1], ids[0]] }, actor)).count, 2);
    assert.equal(await db.customer.count({ where: { id: { in: ids.slice(0, 2) }, deletedAt: { not: null } } }), 2);
    assert.equal(await db.followUp.count({ where: { customerId: ids[0] } }), 1);
    await assert.rejects(batchCustomers({ ids: [ids[0]] }, actor), /状态已变化/);
    assert.equal((await batchCustomers({ ids: ids.slice(0, 2) }, actor, true)).count, 2);
    assert.equal(await db.customer.count({ where: { id: { in: ids }, deletedAt: null } }), 3);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: ids[0] } })).ownerId, admin.id);
    await assert.rejects(batchCustomers({ ids: [] }, actor));
  } finally {
    await db.followUp.deleteMany({ where: { customerId: { in: ids } } });
    await db.deal.deleteMany({ where: { customerId: { in: ids } } });
    // 订单随成交产生，且外键为 RESTRICT，必须先清掉
    await deleteTestOrders({ where: { customerId: { in: ids } } });
    await deleteTestCustomers({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
