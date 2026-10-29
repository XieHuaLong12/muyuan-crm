import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { NEW_CUSTOMERS_FROM, isLegacyCustomer } from '../lib/customer-group';
import { createScript } from '../services/outreach-script-service';
import { outreachNextView, processOutreach } from '../services/outreach-engine-service';
import { outreachDashboard, scriptTouches } from '../services/outreach-analytics-service';
import { reviewList } from '../services/outreach-review-service';
import { customerList } from '../services/customer-list-service';
import { salesQueue, todayWorkCounts } from '../services/bos-sales-service';
import { inboxConversations, inboxThread } from '../services/inbox-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const HOUR = 3_600_000;

test('customer group: 旧客户 inquired before 2026-10-01 Beijing time, the creation time standing in for a missing inquiry date', () => {
  assert.equal(NEW_CUSTOMERS_FROM.toISOString(), '2026-09-30T16:00:00.000Z');
  const now = new Date();
  assert.equal(isLegacyCustomer({ inquiryAt: new Date('2026-09-30T15:59:59Z'), createdAt: now }), true, 'an old inquiry imported today is old');
  assert.equal(isLegacyCustomer({ inquiryAt: new Date('2026-09-30T16:00:00Z'), createdAt: now }), false, 'midnight on 1 October in Beijing is new');
  assert.equal(isLegacyCustomer({ inquiryAt: null, createdAt: new Date('2026-08-01T00:00:00Z') }), true);
  assert.equal(isLegacyCustomer({ inquiryAt: null, createdAt: now }), false);
  assert.equal(isLegacyCustomer({ inquiryAt: '2026-09-01T00:00:00.000Z', createdAt: now.toISOString() }), true, 'JSON dates from the client work too');
});

test('customer group: 旧客户 chat as usual but stay out of script testing, its numbers and the work queues', async () => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), marker = `Group${tag}`;
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachStartedAt: true, outreachConfig: true } });
  await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: new Date('2026-01-01T00:00:00Z'), outreachConfig: {} } });
  const [admin, sales] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }),
    db.user.create({ data: { name: `${marker} Seller`, email: `${marker.toLowerCase()}@example.com`, role: 'SALES', passwordHash: hashPassword('x') } }),
  ]);
  const boss = actorOf(admin), me = actorOf(sales);
  let n = 0;
  const lead = (name: string, data: Record<string, unknown> = {}) => {
    const phone = `+337${String(Date.now()).slice(-6)}${String(++n).padStart(2, '0')}`;
    // Both wait for a first contact that is already late and have a follow-up due: every queue would show them.
    return db.customer.create({ data: { name: `${marker} ${name}`, ownerId: sales.id, source: 'FACEBOOK', sourceDetail: 'Sofa_FR_Oct', country: 'France', leadGrade: 'A',
      whatsapp: phone, phone, phoneE164: phone, whatsappNormalized: phone.slice(1), contactKeysAt: new Date(), assignedAt: new Date(Date.now() - 2 * HOUR),
      firstContactDueAt: new Date(Date.now() - HOUR), nextFollowUpAt: new Date(Date.now() - HOUR), ...data } });
  };
  const content = `Hello from LVANJU ${tag}, we make compressed sofas in Foshan. Do you sell through stores or online?`;
  const script = await createScript({ code: `T0-CG${tag}1`, position: 'T0', grades: ['A'], language: 'en', content }, boss);
  try {
    const old = await lead('Old', { inquiryAt: new Date('2026-09-20T08:00:00Z') });
    const fresh = await lead('New');

    // Two pages: each lists its own group; a filter tells how many match on the other page.
    assert.deepEqual((await customerList(me, {})).rows.map(r => r.id), [fresh.id]);
    assert.deepEqual((await customerList(me, { group: 'legacy' })).rows.map(r => r.id), [old.id]);
    assert.deepEqual((await customerList(me, { group: 'all', sort: 'name' })).rows.map(r => r.id), [fresh.id, old.id]);
    const searched = await customerList(me, { q: marker });
    assert.deepEqual([searched.total, searched.otherTotal], [1, 1]);
    assert.equal((await customerList(me, {})).otherTotal, 0, 'nothing to point at without a filter');
    assert.equal((await customerList(me, { group: 'legacy' })).grades.A, 1, 'the grade tabs count the page they are on');

    // Work queues and the top bar: only the new customer.
    assert.deepEqual(await todayWorkCounts(me), { today: 1, todayOverdue: 1 });
    for (const queue of ['today', 'new', 'recent']) assert.deepEqual((await salesQueue(me, { queue })).customers.map(c => c.id), [fresh.id], queue);
    const pending = await inboxConversations(me, { filter: 'pending' });
    assert.deepEqual([pending.pending.map(c => c.id), pending.pendingTotal], [[fresh.id], 1], '待首联 only lists new customers');

    // Records an old customer had before the split are kept, outside every number.
    const legacyTouch = (status: string, hoursAgo: number) => db.outreachTouch.create({ data: { groupKey: `legacy-${tag}-${status}`, customerId: old.id, kind: 'ICEBREAK', code: 'T0',
      scriptId: script.id, matchType: status === 'DONE' ? 'EXACT' : '', judgeStatus: status, judgedBy: status === 'DONE' ? 'RULE' : '', senderId: sales.id,
      sentAt: new Date(Date.now() - hoursAgo * HOUR), channel: 'PHONE', grade: 'A', language: 'en', replied24h: status === 'DONE' ? true : null, replyQuality: status === 'DONE' ? 'HIGH' : '',
      text: content, contentHash: createHash('sha256').update(`${tag}${status}`).digest('hex') } });
    const kept = [await legacyTouch('DONE', 72), await legacyTouch('REVIEW', 60)];
    const leftover = await db.task.create({ data: { customerId: old.id, title: `T1 跟进：${old.name}`, description: '', dueDate: new Date(), createdBy: sales.id,
      source: 'OUTREACH', automationKey: `outreach:${old.id}:0:T1` } });

    // Opening the chat: no script is assigned to the old customer; the new one gets one.
    const oldView = await outreachNextView({ customerId: old.id }, me);
    assert.deepEqual([oldView.legacy, oldView.script], [true, null]);
    assert.equal(await db.outreachAssignment.count({ where: { customerId: old.id } }), 0);
    const freshView = await outreachNextView({ customerId: fresh.id }, me);
    assert.equal(freshView.legacy, false);
    assert.equal(await db.outreachAssignment.count({ where: { customerId: fresh.id } }), 1);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: leftover.id } })).status, 'DONE', 'an outreach task left over from before closes');

    // The same script sent from the phone a day ago: a touch and a T1 task for the new customer, nothing for the old one.
    for (const c of [old, fresh]) {
      await db.whatsAppMessage.create({ data: { customerId: c.id, direction: 'OUTBOUND', content, sentAt: new Date(Date.now() - 30 * HOUR), raw: '{}', source: 'gupshup', status: 'SENT' } });
      await processOutreach(c.id, { ai: false });
    }
    const freshTouch = await db.outreachTouch.findFirstOrThrow({ where: { customerId: fresh.id } });
    assert.deepEqual([freshTouch.scriptId, freshTouch.matchType], [script.id, 'EXACT']);
    assert.ok(await db.task.findFirst({ where: { customerId: fresh.id, automationKey: `outreach:${fresh.id}:0:T1`, status: { not: 'DONE' } } }));
    assert.deepEqual((await db.outreachTouch.findMany({ where: { customerId: old.id }, orderBy: { sentAt: 'asc' } })).map(t => t.id), kept.map(t => t.id),
      'no new touch for the old customer, and the old records stay');
    assert.equal(await db.task.count({ where: { customerId: old.id, automationKey: { startsWith: 'outreach:' }, status: { not: 'DONE' } } }), 0);

    // Script numbers, the script's touch list and the review queue: only the new customer.
    const ranked = (await outreachDashboard(boss, { range: 'all' })).ranking.find(r => r.id === script.id);
    assert.equal(ranked?.sent, 1, 'the old customer\'s answered touch does not count');
    assert.deepEqual((await scriptTouches(script.id, boss, { range: 'all' })).touches.map(t => t.customer.id), [fresh.id]);
    assert.equal((await reviewList(boss, { tab: 'touches' })).touches.some(t => t.id === kept[1].id), false);

    // The message center still shows the old customer's chat, tagged.
    const chats = await inboxConversations(me, { filter: 'all' });
    assert.deepEqual(chats.conversations.map(c => [c.id, c.legacy]).sort(), [[fresh.id, false], [old.id, true]].sort());
    assert.equal((await inboxThread(me, { customerId: old.id })).customer.legacy, true);
  } finally {
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await db.outreachScript.deleteMany({ where: { code: { startsWith: `T0-CG${tag}` } } });
    await db.user.deleteMany({ where: { id: sales.id } });
    await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: setting.outreachStartedAt, outreachConfig: setting.outreachConfig === null ? Prisma.DbNull : setting.outreachConfig } });
  }
});
