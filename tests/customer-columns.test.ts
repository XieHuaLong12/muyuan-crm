import { deleteTestCustomers, deleteTestOrders } from './identity-test-cleanup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { HttpError } from '../lib/auth';
import { CUSTOMER_SORT_KEYS, DEFAULT_CUSTOMER_COLUMNS, normalizeCustomerColumns } from '../lib/customer-columns';
import { customerColumns, resetCustomerColumns, saveCustomerColumns } from '../services/user-view-service';
import { customerList, customerListQuery, customerPreview } from '../services/customer-list-service';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

test('定制列：去重、客户列固定在第一列、忽略已下线的列；可排序的列都是列表接受的排序参数', () => {
  assert.deepEqual(normalizeCustomerColumns(['stage', 'name', 'stage', 'retired-column', 'owner']), ['name', 'stage', 'owner']);
  assert.deepEqual(normalizeCustomerColumns(['retired-column']), [...DEFAULT_CUSTOMER_COLUMNS]);
  assert.deepEqual(normalizeCustomerColumns(undefined), [...DEFAULT_CUSTOMER_COLUMNS]);
  assert.deepEqual(normalizeCustomerColumns(['name']), ['name']);
  assert.deepEqual(normalizeCustomerColumns(DEFAULT_CUSTOMER_COLUMNS), [...DEFAULT_CUSTOMER_COLUMNS]);
  for (const key of CUSTOMER_SORT_KEYS) assert.equal(customerListQuery.parse({ sort: key }).sort, key);
  // 旧书签里的排序参数仍可用；备注不可排序
  for (const key of ['priority', 'productInterest']) assert.equal(customerListQuery.parse({ sort: key }).sort, key);
  assert.throws(() => customerListQuery.parse({ sort: 'notes' }));
});

test('定制列按人保存：只影响本人，可恢复默认，拒绝不存在的列', async () => {
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  const users = [admin.id, sales.id];
  await db.userViewPreference.deleteMany({ where: { userId: { in: users } } });
  try {
    assert.deepEqual(await customerColumns(sales), { columns: [...DEFAULT_CUSTOMER_COLUMNS], custom: false });

    const saved = await saveCustomerColumns({ columns: ['stage', 'name', 'phone', 'stage', 'deals'] }, sales);
    assert.deepEqual(saved, { columns: ['name', 'stage', 'phone', 'deals'], custom: true });
    assert.deepEqual(await customerColumns(sales), saved);
    assert.deepEqual(await customerColumns(admin), { columns: [...DEFAULT_CUSTOMER_COLUMNS], custom: false });

    await saveCustomerColumns({ columns: ['name', 'owner'] }, sales);
    assert.deepEqual((await customerColumns(sales)).columns, ['name', 'owner']);
    assert.equal(await db.userViewPreference.count({ where: { userId: sales.id } }), 1);

    // 同一个人的两次首次保存同时到达：都成功，只留一行
    await Promise.all([
      saveCustomerColumns({ columns: ['name', 'country'] }, admin),
      saveCustomerColumns({ columns: ['name', 'country'] }, admin),
    ]);
    assert.equal(await db.userViewPreference.count({ where: { userId: admin.id } }), 1);
    assert.deepEqual((await customerColumns(admin)).columns, ['name', 'country']);

    await assert.rejects(saveCustomerColumns({ columns: ['name', 'passwordHash'] }, sales), /不存在的列/);
    await assert.rejects(saveCustomerColumns({ columns: [] }, sales), /至少保留一列/);
    await assert.rejects(saveCustomerColumns({}, sales), /请选择要显示的列/);
    assert.deepEqual((await customerColumns(sales)).columns, ['name', 'owner']);

    assert.deepEqual(await resetCustomerColumns(sales), { columns: [...DEFAULT_CUSTOMER_COLUMNS], custom: false });
    assert.equal(await db.userViewPreference.count({ where: { userId: sales.id } }), 0);
    assert.deepEqual((await customerColumns(admin)).columns, ['name', 'country']);

    // 存储内容损坏时回到默认列，而不是让列表打不开
    await db.userViewPreference.update({ where: { userId_view: { userId: admin.id, view: 'customers' } }, data: { columns: { broken: true } } });
    assert.deepEqual(await customerColumns(admin), { columns: [...DEFAULT_CUSTOMER_COLUMNS], custom: false });
  } finally {
    await db.userViewPreference.deleteMany({ where: { userId: { in: users } } });
  }
});

test('客户预览：同列表一样按负责人隔离，带最近三条跟进与成交汇总；新增的列都能排序', async () => {
  const adminUser = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const admin = actorOf(adminUser);
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  const tag = `columns-${Date.now()}`;
  const ids: string[] = [];
  try {
    const buyer = await db.customer.create({ data: { name: `Buyer ${tag}`, ownerId: admin.id, whatsapp: '+971523791940', notes: tag } });
    const quiet = await db.customer.create({ data: { name: `Quiet ${tag}`, ownerId: admin.id, notes: tag } });
    ids.push(buyer.id, quiet.id);
    for (let day = 1; day <= 4; day++) {
      await db.followUp.create({ data: { customerId: buyer.id, type: 'WHATSAPP', content: `第 ${day} 次跟进`, followUpAt: new Date(Date.UTC(2026, 9, day)), createdBy: admin.id } });
    }
    await db.deal.create({ data: { customerId: buyer.id, dealAmount: 1200, productCost: 800, grossProfit: 400, grossMargin: 0.3333, currency: 'USD', dealDate: new Date() } });

    const preview = await customerPreview(buyer.id, admin);
    assert.deepEqual(preview.followUps.map(f => f.content), ['第 4 次跟进', '第 3 次跟进', '第 2 次跟进']);
    assert.equal(preview.followUpCount, 4);
    assert.equal(preview.submissionCount, 0);
    assert.equal(preview.deals.length, 1);
    assert.equal(preview.owner.name, adminUser.name);
    assert.equal(preview.contact?.kind, 'WHATSAPP');
    assert.ok(!('whatsappMessages' in preview), '预览不加载聊天记录');

    await assert.rejects(customerPreview(buyer.id, sales), (e: unknown) => e instanceof HttpError && e.status === 404);
    await assert.rejects(customerPreview('', admin));

    for (const sort of CUSTOMER_SORT_KEYS) {
      for (const dir of ['asc', 'desc']) {
        const page = await customerList(admin, { q: `${tag}`, sort, dir });
        assert.deepEqual(new Set(page.rows.map(r => r.id)), new Set(ids), `按 ${sort} ${dir} 排序`);
      }
    }
    assert.deepEqual((await customerList(admin, { q: tag, sort: 'deals', dir: 'desc' })).rows.map(r => r.id), [buyer.id, quiet.id]);
    assert.deepEqual((await customerList(admin, { q: tag, sort: 'deals', dir: 'asc' })).rows.map(r => r.id), [quiet.id, buyer.id]);

    await db.customer.update({ where: { id: quiet.id }, data: { deletedAt: new Date() } });
    await assert.rejects(customerPreview(quiet.id, admin), (e: unknown) => e instanceof HttpError && e.status === 404);
  } finally {
    await db.followUp.deleteMany({ where: { customerId: { in: ids } } });
    await db.deal.deleteMany({ where: { customerId: { in: ids } } });
    await deleteTestOrders({ where: { customerId: { in: ids } } });
    await deleteTestCustomers({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
