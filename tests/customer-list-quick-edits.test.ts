import { deleteTestCustomers } from './identity-test-cleanup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { HttpError } from '../lib/auth';
import { setQualification } from '../services/customer-service';
import { customerList } from '../services/customer-list-service';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const status = (code: number) => (e: unknown) => e instanceof HttpError && e.status === code;

test('列表里直接改有效性：无效要填原因、按列表显示的值比对、成交客户与无效阶段不能改、销售只能改自己的客户', async () => {
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  const tag = `qualify-${Date.now()}`;
  const ids: string[] = [];
  try {
    const lead = await db.customer.create({ data: { name: `Lead ${tag}`, ownerId: admin.id } });
    const won = await db.customer.create({ data: { name: `Won ${tag}`, ownerId: admin.id, stage: 'WON', isQualified: true } });
    const invalidStage = await db.customer.create({ data: { name: `Invalid ${tag}`, ownerId: admin.id, stage: 'INVALID', isQualified: false, invalidReason: '垃圾询盘' } });
    ids.push(lead.id, won.id, invalidStage.id);

    assert.deepEqual(await setQualification(lead.id, { from: null, to: true }, admin), { isQualified: true });
    const valid = await db.customer.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(valid.isQualified, true);
    assert.equal(valid.stage, 'NEW', '有效性不改变阶段');
    assert.equal(await db.advertisingFeedback.count({ where: { eventId: `qualified:${lead.id}:v1` } }), 1, '与客户表单一样登记 QualifiedLead 回传');

    // 列表显示的是旧值：拒绝覆盖别人刚做的判断
    await assert.rejects(setQualification(lead.id, { from: null, to: false, reason: '零售客户' }, admin), status(409));
    await assert.rejects(setQualification(lead.id, { from: true, to: false }, admin), /请填写原因/);
    await assert.rejects(setQualification(lead.id, { from: true, to: false, reason: ' ' }, admin), /请填写原因/);
    await setQualification(lead.id, { from: true, to: false, reason: '零售客户' }, admin);
    const invalid = await db.customer.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(invalid.isQualified, false);
    assert.equal(invalid.invalidReason, '零售客户');
    await setQualification(lead.id, { from: false, to: null }, admin);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: lead.id } })).isQualified, null);

    await assert.rejects(setQualification(won.id, { from: true, to: false, reason: '零售客户' }, admin), /已成交客户/);
    await assert.rejects(setQualification(invalidStage.id, { from: false, to: true }, admin), /无效客户/);
    await assert.rejects(setQualification(lead.id, { from: null, to: true }, sales), status(404));
    await assert.rejects(setQualification(lead.id, { from: 'yes', to: true }, admin), /有效性格式不正确/);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: lead.id } })).isQualified, null);
  } finally {
    await deleteTestCustomers({ where: { id: { in: ids } } });
  }
});

test('A / B / C 页签：按自动表单等级计数，计数只含本人能看到的客户', async () => {
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  const tag = `grades-${Date.now()}`;
  const ids: string[] = [];
  try {
    const before = { admin: (await customerList(admin, {})).grades, sales: (await customerList(sales, {})).grades };
    for (const [grade, ownerId] of [['A', sales.id], ['A', admin.id], ['B', sales.id], ['C', admin.id], ['D', sales.id], ['', sales.id]] as const) {
      ids.push((await db.customer.create({ data: { name: `Grade ${grade || 'none'} ${tag}`, ownerId, leadGrade: grade } })).id);
    }
    const after = { admin: (await customerList(admin, {})).grades, sales: (await customerList(sales, {})).grades };
    assert.deepEqual(Object.keys(after.admin), ['A', 'B', 'C'], 'D 级不单独成页签');
    assert.deepEqual({ A: after.admin.A - before.admin.A, B: after.admin.B - before.admin.B, C: after.admin.C - before.admin.C }, { A: 2, B: 1, C: 1 });
    assert.deepEqual({ A: after.sales.A - before.sales.A, B: after.sales.B - before.sales.B, C: after.sales.C - before.sales.C }, { A: 1, B: 1, C: 0 });
    // 页签就是按等级筛选
    assert.deepEqual((await customerList(admin, { grade: 'A', q: tag })).rows.map(r => r.name).sort(), [`Grade A ${tag}`, `Grade A ${tag}`]);
    assert.deepEqual((await customerList(sales, { grade: 'A', q: tag })).rows.map(r => r.ownerId), [sales.id]);
  } finally {
    await deleteTestCustomers({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
