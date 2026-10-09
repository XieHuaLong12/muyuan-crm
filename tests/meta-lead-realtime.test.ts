import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '../lib/db';
import type { Actor } from '../lib/auth';
import { POST as webhook } from '../app/api/leads/webhook/route';
import { POST as cron } from '../app/api/cron/meta-leads/route';
import { pollMetaLeads, metaLeadHealth } from '../services/meta-lead-intake-service';
import { retryDueMetaLeads, retryDelayMs, TEST_LEAD_NOTE } from '../services/meta-lead-service';
import { assignCustomers } from '../services/lead-assignment-service';
import { addFollowUp } from '../services/customer-service';
import { notificationFeed } from '../services/notification-service';
import { saveFirstContactPolicy, salesPerformance } from '../services/sales-team-service';
import { createUserAccount, updateSalesAccount } from '../services/sales-account-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const appSecret = 'realtime-test-app-secret', token = 'realtime-test-page-token', cronSecret = 'realtime-test-cron-secret';
const actor = (u: { id: string; name: string; email: string; role: string }): Actor => ({ id: u.id, name: u.name, email: u.email, role: u.role });

type GraphRow = { id: string; created_time: string; form_id: string; platform?: string; field_data: { name: string; values: string[] }[] };
const leadRow = (id: string, formId: string, email: string, minutesAgo = 1): GraphRow => ({
  id, form_id: formId, created_time: new Date(Date.now() - minutesAgo * 60_000).toISOString().replace('Z', '+0000'),
  field_data: [{ name: 'full_name', values: [`Realtime ${id}`] }, { name: 'email', values: [email] }, { name: 'country', values: ['Germany'] }],
});

/** Fake Graph API: single-lead reads, form lead lists and a failure switch. */
function mockGraph(leads: Map<string, GraphRow>, forms: Map<string, string[]>, fail = new Set<string>()) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'graph.facebook.com');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
    const parts = url.pathname.split('/').filter(Boolean).slice(1);
    if (parts[1] === 'leads') {
      const since = Number(JSON.parse(url.searchParams.get('filtering') || '[]')[0]?.value ?? 0) * 1000;
      const rows = (forms.get(parts[0]) ?? []).map(id => leads.get(id)!).filter(row => Date.parse(row.created_time.replace('+0000', 'Z')) > since);
      return Response.json({ data: rows });
    }
    const id = decodeURIComponent(parts[0]);
    if (fail.has(id)) return Response.json({ error: { code: 2, message: 'Temporary' } }, { status: 503 });
    const row = leads.get(id);
    return row ? Response.json(row) : Response.json({ error: { code: 100, message: 'Unknown' } }, { status: 400 });
  }) as typeof fetch;
}

function signed(body: unknown) {
  const raw = JSON.stringify(body);
  return new NextRequest('https://example.test/api/leads/webhook', { method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}` } });
}
const push = (leadgenId: string, formId: string) => ({ object: 'page', entry: [{ id: 'page-realtime', changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, form_id: formId, page_id: 'page-realtime' } }] }] });

test('ad leads arrive in real time, are recovered by the poll, and reach a salesperson within minutes', async t => {
  const env = { ...process.env };
  const original = globalThis.fetch;
  const adminRow = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const admin = actor(adminRow);
  const tag = randomUUID().slice(0, 8), formId = `form-rt-${tag}`;
  const leads = new Map<string, GraphRow>(), forms = new Map<string, string[]>([[formId, []]]);
  const leadIds: string[] = [], users: string[] = [];
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const addLead = (minutesAgo = 1) => {
    const id = `rt-${tag}-${leadIds.length}`;
    leads.set(id, leadRow(id, formId, `${id}@example.test`, minutesAgo));
    forms.get(formId)!.push(id); leadIds.push(id);
    return id;
  };
  process.env.META_APP_SECRET = appSecret;
  process.env.META_PAGE_ACCESS_TOKEN = token;
  process.env.META_SYNC_SECRET = cronSecret;
  delete process.env.META_PAGE_ID;
  delete process.env.META_ADS_ACCESS_TOKEN;
  await db.metaLeadForm.create({ data: { formId, name: `Realtime form ${tag}`, status: 'ACTIVE' } });
  // Other forms in the shared test database must not be polled against the fake Graph API.
  const otherForms = await db.metaLeadForm.findMany({ where: { status: 'ACTIVE', formId: { not: formId } }, select: { formId: true } });
  await db.metaLeadForm.updateMany({ where: { formId: { in: otherForms.map(f => f.formId) } }, data: { status: 'PAUSED_FOR_TEST' } });
  try {
    mockGraph(leads, forms);
    const sales = actor(await createUserAccount({ name: `RT sales ${tag}`, email: `rt-${tag}@example.test`, password: 'realtime-password' }, admin));
    users.push(sales.id);

    await t.test('the webhook imports a lead within the request and the poll does not duplicate it', async () => {
      const id = addLead();
      const response = await webhook(signed(push(id, formId)));
      assert.equal(response.status, 200);
      const event = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: id } });
      assert.equal(event.status, 'CREATED');
      assert.equal(event.receivedVia, 'WEBHOOK');
      assert.ok(event.metaCreatedAt);
      const result = await pollMetaLeads();
      assert.equal(result.recovered, 0);
      assert.equal(result.alreadyImported, 1);
      assert.equal(await db.customer.count({ where: { email: `${id}@example.test` } }), 1);
    });

    await t.test('a lead the webhook never delivered is recovered by the poll into the assignment pool', async () => {
      const missed = addLead(3);
      const result = await pollMetaLeads();
      assert.equal(result.recovered, 1);
      const event = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: missed } });
      assert.equal(event.receivedVia, 'POLL');
      assert.equal(event.status, 'CREATED');
      const customer = await db.customer.findUniqueOrThrow({ where: { id: event.customerId! } });
      assert.equal(customer.pendingAssignment, true);
      const form = await db.metaLeadForm.findUniqueOrThrow({ where: { formId } });
      assert.ok(form.pollWatermark && form.polledAt);
      assert.equal((await pollMetaLeads()).recovered, 0);
      const feed = await notificationFeed(admin);
      assert.ok(feed.items.some(item => item.id === `pool:${customer.id}` && item.kind === 'POOL_LEAD'));
      const health = await metaLeadHealth(admin);
      assert.ok(health.alerts.some(alert => alert.includes('定时补拉补回')));
      assert.ok(health.latencySeconds.samples >= 2);
      await assert.rejects(metaLeadHealth(sales), { status: 403 });
    });

    await t.test('assigned fresh ad leads must be contacted within the ad deadline and announce themselves', async () => {
      const event = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: leadIds[1] } });
      await assignCustomers({ ids: [event.customerId!], ownerId: sales.id }, admin);
      const customer = await db.customer.findUniqueOrThrow({ where: { id: event.customerId! } });
      assert.equal(customer.firstContactDueAt!.getTime() - customer.assignedAt!.getTime(), setting.adLeadFirstContactMinutes * 60_000);
      const task = await db.task.findFirstOrThrow({ where: { customerId: customer.id, automationKey: { startsWith: 'first-contact:' }, status: 'TODO' }, include: { reminders: true } });
      assert.match(task.title, /广告线索/);
      assert.ok(task.reminders.some(r => r.kind === 'EARLY' && r.remindAt <= new Date()));
      const feed = await notificationFeed(sales);
      const assigned = feed.items.find(item => item.kind === 'ASSIGNED' && item.href === `/customers/${customer.id}`);
      assert.ok(assigned && assigned.body.includes(`${setting.adLeadFirstContactMinutes} 分钟`));
      // The immediate first-contact reminder is not announced twice.
      assert.ok(!feed.items.some(item => item.kind === 'FIRST_CONTACT_OVERDUE' && item.href === `/customers/${customer.id}`));
      // Old customers assigned without a fresh ad lead keep the hour-based deadline.
      const plain = await db.customer.create({ data: { name: `RT plain ${tag}`, ownerId: admin.id } });
      await assignCustomers({ ids: [plain.id], ownerId: sales.id }, admin);
      const plainAfter = await db.customer.findUniqueOrThrow({ where: { id: plain.id } });
      assert.equal(plainAfter.firstContactDueAt!.getTime() - plainAfter.assignedAt!.getTime(), setting.firstContactHours * 3600_000);
      assert.equal((await salesPerformance(admin)).poolWait!.assigned >= 1, true);
    });

    await t.test('a repeat submission gives the owner a contact task that a follow-up closes', async () => {
      const first = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: leadIds[1] } });
      const email = (await db.customer.findUniqueOrThrow({ where: { id: first.customerId! } })).email;
      const again = `rt-${tag}-again`;
      leads.set(again, { ...leadRow(again, formId, email), field_data: [{ name: 'full_name', values: ['Same buyer'] }, { name: 'email', values: [email] }] });
      leadIds.push(again);
      await webhook(signed(push(again, formId)));
      assert.equal((await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: again } })).status, 'LINKED');
      const task = await db.task.findFirstOrThrow({ where: { automationKey: `resubmit:${first.customerId}:${again}` } });
      assert.equal(task.createdBy, sales.id);
      assert.equal(task.priority, 'HIGH');
      assert.ok((await notificationFeed(sales)).items.some(item => item.kind === 'REPEAT_SUBMISSION'));
      // The administrator's bell counts it, but only its owner is interrupted.
      const adminFeed = await notificationFeed(admin);
      assert.ok(!adminFeed.items.some(item => item.kind === 'REPEAT_SUBMISSION' && item.href === `/customers/${first.customerId}`));
      assert.ok(adminFeed.counts.reminders >= 1);
      await addFollowUp(first.customerId!, { type: 'WHATSAPP', content: '已回复再次留资', followUpAt: new Date().toISOString() }, sales);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'DONE');
      // A catch-up that finds a submission from days ago records it without asking for a call within minutes.
      const old = `rt-${tag}-old`;
      leads.set(old, { ...leadRow(old, formId, email, 3 * 24 * 60), field_data: [{ name: 'email', values: [email] }] });
      forms.get(formId)!.push(old); leadIds.push(old);
      assert.equal((await pollMetaLeads({ days: 7 })).recovered, 1);
      assert.equal((await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: old } })).status, 'LINKED');
      assert.equal(await db.task.count({ where: { automationKey: `resubmit:${first.customerId}:${old}` } }), 0);
    });

    await t.test('Instagram leads keep their source and testing-tool leads are explained, not retried', async () => {
      const ig = `rt-${tag}-ig`;
      leads.set(ig, { ...leadRow(ig, formId, `${ig}@example.test`), platform: 'ig' });
      leadIds.push(ig);
      await webhook(signed(push(ig, formId)));
      const event = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: ig } });
      assert.equal((await db.customer.findUniqueOrThrow({ where: { id: event.customerId! } })).source, 'INSTAGRAM');
      const dummy = `rt-${tag}-dummy`;
      leads.set(dummy, { ...leadRow(dummy, formId, 'unused'), field_data: ['full_name', 'email', 'phone_number'].map(name => ({ name, values: [`<test lead: dummy data for ${name}>`] })) });
      leadIds.push(dummy);
      await webhook(signed(push(dummy, formId)));
      const tested = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: dummy } });
      assert.equal(tested.status, 'FAILED');
      assert.ok(tested.error.includes(TEST_LEAD_NOTE));
      assert.equal(tested.nextAttemptAt, null, 'placeholder data is not retried');
      const notice = (await notificationFeed(admin)).items.find(item => item.id === `lead-human:${dummy}`);
      assert.equal(notice?.title, '收到 Meta 测试线索');
    });

    await t.test('a disabled owner sends a repeat submission back to the pool', async () => {
      const first = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: leadIds[1] } });
      const email = (await db.customer.findUniqueOrThrow({ where: { id: first.customerId! } })).email;
      const current = await db.user.findUniqueOrThrow({ where: { id: sales.id } });
      await updateSalesAccount(sales.id, { action: 'status', isActive: false, sessionVersion: current.sessionVersion }, admin);
      const third = `rt-${tag}-third`;
      leads.set(third, { ...leadRow(third, formId, email), field_data: [{ name: 'email', values: [email] }] });
      leadIds.push(third);
      await webhook(signed(push(third, formId)));
      const customer = await db.customer.findUniqueOrThrow({ where: { id: first.customerId! } });
      assert.equal(customer.pendingAssignment, true);
      assert.notEqual(customer.ownerId, sales.id);
    });

    await t.test('failed imports back off and the scheduled job retries them when due', async () => {
      const flaky = addLead();
      const failing = new Set([flaky]);
      mockGraph(leads, new Map([[formId, []]]), failing);
      await webhook(signed(push(flaky, formId)));
      const failed = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: flaky } });
      assert.equal(failed.status, 'FAILED');
      assert.equal(failed.attempts, 1);
      assert.ok(failed.nextAttemptAt && failed.nextAttemptAt.getTime() - Date.now() <= retryDelayMs(1));
      failing.clear();
      await retryDueMetaLeads();
      assert.equal((await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: flaky } })).status, 'FAILED', 'not due yet');
      await db.metaLeadEvent.update({ where: { leadgenId: flaky }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      assert.ok((await retryDueMetaLeads()).succeeded >= 1);
      assert.equal((await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: flaky } })).status, 'CREATED');
      assert.equal(retryDelayMs(20), 60 * 60_000);
    });

    await t.test('the scheduled job requires its secret', async () => {
      const denied = await cron(new NextRequest('http://localhost/api/cron/meta-leads', { method: 'POST' }));
      assert.equal(denied.status, 401);
      const ok = await cron(new NextRequest('http://localhost/api/cron/meta-leads', { method: 'POST', headers: { 'x-cron-secret': cronSecret } }));
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.data.poll.status, 'CONNECTED');
    });

    await t.test('administrators set the ad lead deadline', async () => {
      await assert.rejects(saveFirstContactPolicy({ adLeadMinutes: 10 }, sales), { status: 403 });
      await saveFirstContactPolicy({ adLeadMinutes: 10 }, admin);
      assert.equal((await db.setting.findUniqueOrThrow({ where: { id: 'system' } })).adLeadFirstContactMinutes, 10);
    });
  } finally {
    globalThis.fetch = original;
    for (const key of ['META_APP_SECRET', 'META_PAGE_ACCESS_TOKEN', 'META_SYNC_SECRET', 'META_PAGE_ID', 'META_ADS_ACCESS_TOKEN']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    const events = await db.metaLeadEvent.findMany({ where: { leadgenId: { in: leadIds } }, select: { customerId: true } });
    const customerIds = events.map(e => e.customerId).filter((id): id is string => !!id);
    await db.metaLeadEvent.deleteMany({ where: { leadgenId: { in: leadIds } } });
    await deleteTestCustomers({ where: { OR: [{ id: { in: customerIds } }, { name: { startsWith: `RT plain ${tag}` } }, { ownerId: { in: users } }] } });
    await db.metaLeadForm.deleteMany({ where: { formId } });
    await db.metaLeadForm.updateMany({ where: { status: 'PAUSED_FOR_TEST' }, data: { status: 'ACTIVE' } });
    await db.task.deleteMany({ where: { createdBy: { in: users } } });
    await db.customerAssignment.deleteMany({ where: { OR: [{ toOwnerId: { in: users } }, { fromOwnerId: { in: users } }] } });
    await db.accountAudit.deleteMany({ where: { subjectId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.setting.update({ where: { id: 'system' }, data: { adLeadFirstContactMinutes: setting.adLeadFirstContactMinutes } });
    await db.$disconnect();
  }
});
