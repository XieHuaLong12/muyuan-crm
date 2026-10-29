import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { HttpError } from '../lib/auth';
import { QUALIFYING_STAGES, stageQualifies } from '../lib/constants';
import { moveCustomerStage } from '../services/bos-crm-service';
import { saveCustomer, setQualification } from '../services/customer-service';
import { recordWorkflowEvent } from '../services/workflow-service';
import { messageFacts, requalifyEarlyMessages } from '../services/conversation-identity-service';
import { repliedAfterContact } from '../lib/metrics';
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

test('有效 starts with a reply to our first message: an ad message before it changes nothing', async () => {
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const tag = randomUUID().slice(0, 8);
  const make = (name: string, data: object = {}) => db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, stage: 'NEW', stageSource: 'SYSTEM', ...data } });
  const state = (id: string) => db.customer.findUniqueOrThrow({ where: { id }, select: { stage: true, isQualified: true } });
  const feedback = (id: string) => db.advertisingFeedback.count({ where: { eventId: `qualified:${id}:v1` } });
  const facts = (id: string, at: string, direction: string) => db.$transaction(tx => messageFacts(tx, id, new Date(at), direction));
  try {
    assert.equal(repliedAfterContact({ stage: 'NEW', contactedAt: null, lastInboundAt: new Date() }), false);
    assert.equal(repliedAfterContact({ stage: 'CONTACTED', contactedAt: null, lastInboundAt: new Date() }), true, '已联系 before the records began');
    assert.equal(repliedAfterContact({ stage: 'NEW', contactedAt: new Date('2026-10-02'), lastInboundAt: new Date('2026-10-01') }), false);

    // The ad's prefilled message arrives first: still 新线索, 待判断, nothing for Meta.
    const ad = await make('Ad');
    await facts(ad.id, '2026-10-01T10:00:00Z', 'INBOUND');
    assert.deepEqual(await state(ad.id), { stage: 'NEW', isQualified: null });
    // Our first message: 已联系. They write again afterwards: 已回复 and 有效, reported once.
    await facts(ad.id, '2026-10-01T10:05:00Z', 'OUTBOUND');
    assert.deepEqual(await state(ad.id), { stage: 'CONTACTED', isQualified: null });
    assert.equal(await feedback(ad.id), 0);
    await facts(ad.id, '2026-10-01T11:00:00Z', 'INBOUND');
    assert.deepEqual(await state(ad.id), { stage: 'REPLIED', isQualified: true });
    assert.equal(await feedback(ad.id), 1);

    // A history import out of order ends in the same place: their later message first, then our earlier one.
    const imported = await make('Import');
    await facts(imported.id, '2026-10-03T09:00:00Z', 'INBOUND');
    assert.deepEqual(await state(imported.id), { stage: 'NEW', isQualified: null });
    await facts(imported.id, '2026-10-03T08:00:00Z', 'OUTBOUND');
    assert.deepEqual(await state(imported.id), { stage: 'REPLIED', isQualified: true });
    // …and a message that came before ours stays not a reply, whatever arrives later.
    const early = await make('Early');
    await facts(early.id, '2026-10-04T08:00:00Z', 'OUTBOUND');
    await facts(early.id, '2026-10-04T07:00:00Z', 'INBOUND');
    assert.deepEqual(await state(early.id), { stage: 'CONTACTED', isQualified: null });

    // History: customers the old rule made 已回复 from an early message go back; a real reply and a person's stage stay.
    const old = await make('Old', { stage: 'REPLIED', isQualified: true, contactedAt: new Date('2026-09-02T10:00:00Z'), lastInboundAt: new Date('2026-09-02T09:00:00Z') });
    await db.stageHistory.create({ data: { customerId: old.id, fromStage: 'NEW', toStage: 'REPLIED', changedBy: admin.id, note: 'SYSTEM: 已入库 WhatsApp 消息事实' } });
    await db.advertisingFeedback.create({ data: { eventId: `qualified:${old.id}:v1`, eventName: 'LeadQualified', customerId: old.id, eventTime: new Date(), payload: {} } });
    const uncontacted = await make('Uncontacted', { stage: 'REPLIED', isQualified: true, lastInboundAt: new Date('2026-09-03T09:00:00Z') });
    const real = await make('Real', { stage: 'REPLIED', isQualified: true, contactedAt: new Date('2026-09-02T08:00:00Z'), lastInboundAt: new Date('2026-09-02T09:00:00Z') });
    const human = await make('Human', { stage: 'REPLIED', stageSource: 'HUMAN', isQualified: true, lastInboundAt: new Date('2026-09-02T09:00:00Z') });
    const result = await requalifyEarlyMessages();
    assert.ok(result.moved >= 2 && result.cancelled >= 1);
    assert.deepEqual(await state(old.id), { stage: 'CONTACTED', isQualified: null });
    assert.deepEqual(await state(uncontacted.id), { stage: 'NEW', isQualified: null });
    assert.deepEqual(await state(real.id), { stage: 'REPLIED', isQualified: true });
    assert.deepEqual(await state(human.id), { stage: 'REPLIED', isQualified: true });
    assert.equal(await feedback(old.id), 0, 'the unsent LeadQualified no longer holds the key');
    assert.equal((await db.advertisingFeedback.findUniqueOrThrow({ where: { eventId: `qualified:${old.id}:v1:revoked` } })).status, 'BUSINESS_CANCELLED');
    assert.equal((await db.stageHistory.findFirstOrThrow({ where: { customerId: old.id }, orderBy: { changedAt: 'desc' } })).toStage, 'CONTACTED');
    // Running it again changes nothing; a real reply later qualifies and reports again.
    const again = await requalifyEarlyMessages();
    assert.deepEqual(await state(old.id), { stage: 'CONTACTED', isQualified: null });
    assert.ok(again.moved <= result.moved);
    await facts(old.id, '2026-09-05T10:00:00Z', 'INBOUND');
    assert.deepEqual(await state(old.id), { stage: 'REPLIED', isQualified: true });
    assert.equal(await feedback(old.id), 1);
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.$disconnect();
  }
});
