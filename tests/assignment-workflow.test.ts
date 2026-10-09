import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { token, sessionUser, type Actor } from '../lib/auth';
import { createUserAccount, changeOwnPassword, updateSalesAccount, salesAccounts } from '../services/sales-account-service';
import { saveCustomer, addFollowUp, addDeal, updateDeal, voidDeal, deleteCustomer, updateFollowUp, deleteFollowUp, duplicates } from '../services/customer-service';
import { assignCustomers, saveLeadAssignMode } from '../services/lead-assignment-service';
import { importLead } from '../services/lead-import-service';
import { customerList } from '../services/customer-list-service';
import { salesQueue } from '../services/bos-sales-service';
import { salesPerformance, firstContactFocus } from '../services/sales-team-service';
import { moveCustomerStage, crmBoard } from '../services/bos-crm-service';
import { batchCustomers, purgeCustomers } from '../services/customer-batch-service';
import { cancelOrder, changeOrderMilestone } from '../services/order-service';
import { createTask, listTasks } from '../services/task-service';
import { syncCustomerWorkflow } from '../services/workflow-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actor = (u: { id: string; name: string; email: string; role: string }): Actor => ({ id: u.id, name: u.name, email: u.email, role: u.role });

test('lead pool, assignment, duplicates, corrections and deletion rules', async t => {
  const adminRow = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const admin = actor(adminRow);
  const tag = randomUUID().slice(0, 8);
  const users: string[] = [], customers: string[] = [], tasks: string[] = [];
  const original = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const track = <T extends { id: string }>(c: T) => { customers.push(c.id); return c; };
  try {
    const a = actor(await createUserAccount({ name: `Pool sales A ${tag}`, email: `pool-a-${tag}@example.test`, password: 'pool-test-password' }, admin));
    const b = actor(await createUserAccount({ name: `Pool sales B ${tag}`, email: `pool-b-${tag}@example.test`, password: 'pool-test-password' }, admin));
    users.push(a.id, b.id);

    await t.test('webhook leads enter the pool without a first-contact clock', async () => {
      const lead = await importLead({ name: `Pool lead ${tag}`, email: `pool-lead-${tag}@example.test` });
      assert.equal(lead.created, true);
      const c = track(await db.customer.findUniqueOrThrow({ where: { id: lead.customerId! } }));
      assert.equal(c.pendingAssignment, true);
      assert.equal(c.firstContactDueAt, null);
      assert.equal(await db.task.count({ where: { customerId: c.id, automationKey: { startsWith: 'first-contact:' }, status: { not: 'DONE' } } }), 0);
      assert.ok((await firstContactFocus(admin)).pool >= 1);
      const pooled = await customerList(admin, { assign: 'pending', q: `Pool lead ${tag}` });
      assert.deepEqual(pooled.rows.map(r => r.id), [c.id]);
      assert.ok(((await salesPerformance(admin)).unassigned ?? 0) >= 1);

      await assert.rejects(assignCustomers({ ids: [c.id], ownerId: a.id }, a), { status: 403 });
      const assigned = await assignCustomers({ ids: [c.id], ownerId: a.id, reason: '按国家分配' }, admin);
      assert.equal(assigned.assigned, 1);
      const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(after.ownerId, a.id);
      assert.equal(after.pendingAssignment, false);
      assert.ok(after.firstContactDueAt && after.assignedAt);
      assert.equal(await db.task.count({ where: { customerId: c.id, automationKey: { startsWith: 'first-contact:' }, status: 'TODO' } }), 1);
      assert.equal(await db.customerAssignment.count({ where: { customerId: c.id, toOwnerId: a.id, reason: '按国家分配' } }), 1);
      assert.ok((await salesQueue(a, { queue: 'new' })).customers.some(r => r.id === c.id));
      // Assigning again to the same owner is a no-op.
      assert.equal((await assignCustomers({ ids: [c.id], ownerId: a.id }, admin)).unchanged, 1);
    });

    await t.test('round robin hands consecutive leads to different salespeople', async () => {
      await saveLeadAssignMode({ mode: 'ROUND_ROBIN' }, admin);
      await assert.rejects(saveLeadAssignMode({ mode: 'POOL' }, a), { status: 403 });
      const first = await importLead({ name: `RR one ${tag}`, email: `rr-one-${tag}@example.test` });
      const second = await importLead({ name: `RR two ${tag}`, email: `rr-two-${tag}@example.test` });
      const [one, two] = await Promise.all([first, second].map(r => db.customer.findUniqueOrThrow({ where: { id: r.customerId! }, include: { owner: true } })));
      track(one); track(two);
      assert.notEqual(one.ownerId, two.ownerId);
      for (const c of [one, two]) {
        assert.equal(c.owner.role, 'SALES');
        assert.equal(c.pendingAssignment, false);
        assert.ok(c.firstContactDueAt);
      }
      await saveLeadAssignMode({ mode: 'POOL' }, admin);
    });

    await t.test('salespeople cannot force duplicates and see who holds the contact', async () => {
      const phone = `+4420794${String(Date.now()).slice(-5)}`;
      const owned = track(await saveCustomer({ name: `Dup owner ${tag}`, ownerId: a.id, whatsapp: phone }, admin));
      await assert.rejects(saveCustomer({ name: `Dup attempt ${tag}`, ownerId: b.id, whatsapp: phone, forceDuplicate: true }, b),
        (e: { status: number; message: string; details: { canForce: boolean; customers: unknown[] } }) =>
          e.status === 409 && e.message.includes(a.name) && e.details.canForce === false && e.details.customers.length === 0);
      // A legacy duplicate (created before contact keys) does not block editing unrelated fields.
      const legacy = track(await db.customer.create({ data: { name: `Legacy twin ${tag}`, ownerId: a.id, whatsapp: phone } }));
      assert.ok((await duplicates({ whatsapp: phone }, owned.id)).some(d => d.id === legacy.id));
      const fresh = await db.customer.findUniqueOrThrow({ where: { id: owned.id } });
      const edited = await saveCustomer({ name: `Dup owner ${tag}`, ownerId: a.id, whatsapp: phone, notes: 'still editable', source: 'TIKTOK', expectedUpdatedAt: fresh.updatedAt.toISOString() }, a, owned.id);
      assert.equal(edited.notes, 'still editable');
      // Salespeople cannot rewrite the lead source.
      assert.equal(edited.source, fresh.source);
      await assert.rejects(saveCustomer({ name: 'stale', ownerId: a.id, whatsapp: phone, expectedUpdatedAt: fresh.updatedAt.toISOString() }, a, owned.id), { status: 409 });
      // Administrators may still keep both records deliberately.
      track(await saveCustomer({ name: `Dup admin ${tag}`, ownerId: b.id, whatsapp: phone, forceDuplicate: true }, admin));
    });

    await t.test('pausing needs a reason and closes open rule tasks; kanban too', async () => {
      const c = track(await saveCustomer({ name: `Pause ${tag}`, ownerId: a.id }, admin));
      const current = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
      await assert.rejects(saveCustomer({ name: c.name, ownerId: a.id, stage: 'PAUSED', expectedUpdatedAt: current.updatedAt.toISOString() }, a, c.id), { status: 400 });
      await saveCustomer({ name: c.name, ownerId: a.id, stage: 'PAUSED', invalidReason: '明年再采购', expectedUpdatedAt: current.updatedAt.toISOString() }, a, c.id);
      assert.equal(await db.task.count({ where: { customerId: c.id, status: { not: 'DONE' } } }), 0);
      assert.equal((await db.stageHistory.findFirstOrThrow({ where: { customerId: c.id, toStage: 'PAUSED' } })).note, '明年再采购');
      assert.equal((await salesPerformance(admin)).rows.find(r => r.id === a.id)?.closedByOwner, 1);
      const k = track(await saveCustomer({ name: `Kanban ${tag}`, ownerId: a.id }, admin));
      await assert.rejects(moveCustomerStage(a, { customerId: k.id, fromStage: 'NEW', toStage: 'LOST' }), { status: 400 });
      await moveCustomerStage(a, { customerId: k.id, fromStage: 'NEW', toStage: 'LOST', reason: '选择了其他供应商' });
      const lost = await db.customer.findUniqueOrThrow({ where: { id: k.id } });
      assert.ok(lost.lostAt);
      assert.equal(lost.invalidReason, '选择了其他供应商');
      assert.ok((await crmBoard(a)).customers.some(card => card.id === k.id && card.stage === 'LOST'));
    });

    await t.test('a recorded follow-up answers an inbound message and counts as contact', async () => {
      const c = track(await saveCustomer({ name: `Reply ${tag}`, ownerId: a.id }, admin));
      const inbound = new Date(Date.now() - 3600000);
      await db.customer.update({ where: { id: c.id }, data: { lastInboundAt: inbound } });
      await syncCustomerWorkflow(c.id);
      assert.ok((await salesQueue(a, { queue: 'waiting' })).customers.some(r => r.id === c.id));
      assert.equal(await db.task.count({ where: { customerId: c.id, automationKey: { startsWith: 'reply:' }, status: 'TODO' } }), 1);
      const follow = await addFollowUp(c.id, { type: 'WHATSAPP', content: '已在手机上回复', followUpAt: new Date().toISOString() }, a);
      assert.ok(!(await salesQueue(a, { queue: 'waiting' })).customers.some(r => r.id === c.id));
      assert.equal(await db.task.count({ where: { customerId: c.id, automationKey: { startsWith: 'reply:' }, status: 'TODO' } }), 0);
      assert.ok((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).lastContactAt);
      await assert.rejects(updateFollowUp(c.id, follow.id, { type: 'PHONE', content: 'x' }, b), { status: 404 });
      await updateFollowUp(c.id, follow.id, { type: 'PHONE', content: '电话回复' }, a);
      await assert.rejects(deleteFollowUp(c.id, follow.id, { reason: '录错客户' }, a), { status: 403 });
      await deleteFollowUp(c.id, follow.id, { reason: '录错客户' }, admin);
      assert.equal((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).lastFollowUpAt, null);
      assert.equal(await db.identityAudit.count({ where: { entityType: 'FOLLOW_UP', entityId: follow.id } }), 2);
    });

    await t.test('deals can be corrected or voided, and won customers cannot be deleted', async () => {
      const c = track(await saveCustomer({ name: `Deal fix ${tag}`, ownerId: a.id, stage: 'QUOTED' }, admin));
      const deal = await addDeal(c.id, { dealAmount: 1000, productCost: 600, dealDate: new Date().toISOString(), currency: 'CNY' }, a);
      await assert.rejects(deleteCustomer(c.id, admin), { status: 409 });
      await assert.rejects(batchCustomers({ ids: [c.id] }, admin), { status: 409 });
      await assert.rejects(updateDeal(c.id, deal.id, { dealAmount: 1200, productCost: 600, dealDate: new Date().toISOString(), expectedUpdatedAt: deal.updatedAt.toISOString() }, a), { status: 403 });
      const fixed = await updateDeal(c.id, deal.id, { dealAmount: 1200, productCost: 600, dealDate: new Date().toISOString(), currency: 'CNY', expectedUpdatedAt: deal.updatedAt.toISOString() }, admin);
      assert.equal(fixed.grossProfit.toFixed(2), '600.00');
      const order = await db.order.findUniqueOrThrow({ where: { dealId: deal.id } });
      assert.equal(order.amountRMB.toFixed(2), '1200.00');
      await assert.rejects(changeOrderMilestone(a, order.id, { status: 'COMPLETED', expectedUpdatedAt: order.updatedAt.toISOString() }), { status: 403 });
      await assert.rejects(voidDeal(c.id, deal.id, { reason: '' }, admin));
      await cancelOrder(admin, order.id, { reason: '客户取消订单', expectedUpdatedAt: order.updatedAt.toISOString() });
      assert.equal(await db.deal.count({ where: { id: deal.id } }), 0);
      assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'CANCELLED');
      const reverted = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(reverted.stage, 'QUOTED');
      assert.equal(reverted.wonAt, null);
      assert.equal(await db.identityAudit.count({ where: { entityType: 'DEAL', entityId: deal.id } }), 2);
      await deleteCustomer(c.id, admin);
      assert.ok((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).deletedAt);
    });

    await t.test('purge removes identities and explains what blocks it', async () => {
      const plain = track(await saveCustomer({ name: `Purge ${tag}`, ownerId: a.id, email: `purge-${tag}@example.test` }, admin));
      const chatted = track(await saveCustomer({ name: `Purge chat ${tag}`, ownerId: a.id }, admin));
      await db.whatsAppMessage.create({ data: { customerId: chatted.id, content: 'hi', direction: 'INBOUND', status: 'RECEIVED', raw: '{}', sentAt: new Date() } });
      assert.ok(await db.contactIdentity.count({ where: { customerId: plain.id } }));
      await batchCustomers({ ids: [plain.id, chatted.id] }, admin);
      await assert.rejects(purgeCustomers({ ids: [plain.id, chatted.id] }, admin), (e: { status: number; message: string }) => e.status === 409 && e.message.includes('WhatsApp'));
      assert.equal((await purgeCustomers({ ids: [plain.id] }, admin)).count, 1);
      assert.equal(await db.customer.count({ where: { id: plain.id } }), 0);
    });

    await t.test('standalone tasks can be handed to a salesperson', async () => {
      const handed = await createTask({ title: `Handed ${tag}`, assigneeId: a.id, dueDate: new Date().toISOString() }, admin);
      tasks.push(handed.id);
      await assert.rejects(createTask({ title: `Not allowed ${tag}`, assigneeId: a.id, dueDate: new Date().toISOString() }, b), { status: 403 });
      assert.ok((await listTasks(a, { status: 'ALL' })).tasks.some(task => task.id === handed.id));
      assert.ok(!(await listTasks(b, { status: 'ALL' })).tasks.some(task => task.id === handed.id));
    });

    await t.test('customer list filters, sorts and pages in the database', async () => {
      const page = await customerList(a, { pageSize: 10, sort: 'name', dir: 'asc' });
      assert.ok(page.rows.every(r => r.ownerId === a.id));
      assert.ok(page.total >= page.rows.length);
      const searched = await customerList(admin, { q: `Pause ${tag}` });
      assert.deepEqual(searched.rows.map(r => r.name), [`Pause ${tag}`]);
      assert.equal((await customerList(admin, { owner: b.id, q: tag })).rows.every(r => r.ownerId === b.id), true);
      await assert.rejects(customerList(admin, { pageSize: 7 }));
    });

    await t.test('people change their own password; admins manage each other but never themselves', async () => {
      const before = await db.user.findUniqueOrThrow({ where: { id: a.id } });
      const oldToken = token(a.id, before.sessionVersion);
      await assert.rejects(changeOwnPassword({ currentPassword: 'wrong-password', newPassword: 'new-pool-password' }, a), { status: 400 });
      const changed = await changeOwnPassword({ currentPassword: 'pool-test-password', newPassword: 'new-pool-password' }, a);
      assert.equal(changed.sessionVersion, before.sessionVersion + 1);
      assert.equal(await sessionUser(oldToken), null);
      assert.ok(await sessionUser(token(a.id, changed.sessionVersion)));
      await assert.rejects(updateSalesAccount(admin.id, { action: 'status', isActive: false, sessionVersion: adminRow.sessionVersion }, admin), { status: 400 });
      assert.ok((await salesAccounts(admin)).some(row => row.role === 'ADMIN'));
    });

    await t.test('inactive salespeople with customers are listed for handover', async () => {
      const current = await db.user.findUniqueOrThrow({ where: { id: b.id } });
      await updateSalesAccount(b.id, { action: 'status', isActive: false, sessionVersion: current.sessionVersion }, admin);
      const perf = await salesPerformance(admin);
      assert.ok(perf.handover.some(row => row.id === b.id && row.customers > 0));
      const theirs = await db.customer.findMany({ where: { ownerId: b.id, deletedAt: null }, select: { id: true } });
      await assert.rejects(assignCustomers({ ids: theirs.map(c => c.id), ownerId: b.id }, admin), { status: 400 });
      await assignCustomers({ ids: theirs.map(c => c.id), ownerId: a.id, reason: '离职交接' }, admin);
      assert.ok(!(await salesPerformance(admin)).handover.some(row => row.id === b.id));
    });
  } finally {
    await db.task.deleteMany({ where: { id: { in: tasks } } });
    await deleteTestCustomers({ where: { OR: [{ id: { in: customers } }, { ownerId: { in: users } }] } });
    await db.task.deleteMany({ where: { createdBy: { in: users } } });
    await db.accountAudit.deleteMany({ where: { subjectId: { in: users } } });
    await db.identityAudit.deleteMany({ where: { fromCustomerId: { in: customers } } });
    await db.customerAssignment.deleteMany({ where: { toOwnerId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.setting.update({ where: { id: 'system' }, data: { leadAssignMode: original.leadAssignMode } });
    await db.$disconnect();
  }
});
