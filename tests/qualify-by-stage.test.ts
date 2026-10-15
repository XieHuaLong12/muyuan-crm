import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { HttpError } from '../lib/auth';
import { QUALIFYING_STAGES, stageQualifies } from '../lib/constants';
import { moveCustomerStage } from '../services/bos-crm-service';
import { saveCustomer, setQualification } from '../services/customer-service';
import { recordWorkflowEvent } from '../services/workflow-service';
import { messageFacts } from '../services/conversation-identity-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

test('from 已回复 to 确认采购 a customer is valid without anyone ticking it, however the stage changes', async () => {
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const tag = randomUUID().slice(0, 8);
  const make = (name: string, data: object = {}) => db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, ...data } });
  const qualified = async (id: string) => (await db.customer.findUniqueOrThrow({ where: { id }, select: { isQualified: true } })).isQualified;
  const feedback = (id: string) => db.advertisingFeedback.count({ where: { eventId: `qualified:${id}:v1` } });
  try {
    assert.deepEqual([...QUALIFYING_STAGES], ['REPLIED', 'CATALOG_SENT', 'NEEDS_CONFIRMED', 'PRODUCT_CONFIRMED', 'QUOTED', 'FOLLOW_UP', 'ORDER']);
    assert.deepEqual(['NEW', 'CONTACTED', 'WON', 'PAUSED', 'LOST', 'INVALID'].filter(stageQualifies), []);

    // The stage dropdown (list and kanban): 已联系 is not yet a judgement, 已回复 is.
    const lead = await make('Dropdown');
    await moveCustomerStage(admin, { customerId: lead.id, fromStage: 'NEW', toStage: 'CONTACTED' });
    assert.equal(await qualified(lead.id), null);
    await moveCustomerStage(admin, { customerId: lead.id, fromStage: 'CONTACTED', toStage: 'REPLIED' });
    assert.equal(await qualified(lead.id), true);
    assert.equal(await feedback(lead.id), 1, 'reported to Meta like a manual 有效, once');
    await moveCustomerStage(admin, { customerId: lead.id, fromStage: 'REPLIED', toStage: 'QUOTED' });
    assert.equal(await feedback(lead.id), 1);
    // Leaving the range keeps the judgement; 无效客户 still makes it invalid.
    await moveCustomerStage(admin, { customerId: lead.id, fromStage: 'QUOTED', toStage: 'PAUSED', reason: '明年再采购' });
    assert.equal(await qualified(lead.id), true);
    await moveCustomerStage(admin, { customerId: lead.id, fromStage: 'PAUSED', toStage: 'INVALID', reason: '零售客户' });
    assert.equal(await qualified(lead.id), false);

    // In these stages 有效性 is not changed by hand: 无效 means the 无效客户 stage.
    const quoted = await make('Quoted', { stage: 'QUOTED', isQualified: true });
    await assert.rejects(setQualification(quoted.id, { from: true, to: false, reason: '零售客户' }, admin),
      (e: unknown) => e instanceof HttpError && e.status === 400 && /「已报价」阶段，自动算有效客户/.test(e.message));
    await assert.rejects(setQualification(quoted.id, { from: true, to: null }, admin), /自动算有效客户/);

    // The customer form: a 跟进中 customer saved as 待判断 is saved as 有效.
    const formSaved = await saveCustomer({ name: `Form ${tag}`, ownerId: admin.id, stage: 'FOLLOW_UP', isQualified: null }, admin);
    assert.equal(await qualified(formSaved.id), true);
    const fresh = await saveCustomer({ name: `Fresh ${tag}`, ownerId: admin.id, stage: 'NEW', isQualified: null }, admin);
    assert.equal(await qualified(fresh.id), null, 'earlier stages stay 待判断');

    // 已发目录 recorded as a business fact.
    const catalog = await make('Catalog', { stage: 'CONTACTED' });
    await recordWorkflowEvent({ customerId: catalog.id, requestId: randomUUID(), kind: 'CATALOG_SENT' }, admin);
    assert.deepEqual(await db.customer.findUniqueOrThrow({ where: { id: catalog.id }, select: { stage: true, isQualified: true } }), { stage: 'CATALOG_SENT', isQualified: true });

    // The customer writes back on WhatsApp: the system moves them to 已回复, and they are valid.
    const replied = await make('Reply', { stage: 'CONTACTED', stageSource: 'SYSTEM' });
    await db.$transaction(tx => messageFacts(tx, replied.id, new Date(), 'INBOUND'));
    assert.deepEqual(await db.customer.findUniqueOrThrow({ where: { id: replied.id }, select: { stage: true, isQualified: true } }), { stage: 'REPLIED', isQualified: true });
    assert.equal(await feedback(replied.id), 1);
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.$disconnect();
  }
});
