import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '../lib/db';
import { POST } from '../app/api/leads/webhook/route';

const appSecret = 'integration-test-meta-app-secret';
const token = 'integration-test-page-token';
const previousFetch = globalThis.fetch;

function payload(leadgenId: string) {
  return {
    object: 'page',
    entry: [{ id: 'page-test', time: 1_795_000_000, changes: [
      { field: 'feed', value: { post_id: 'unrelated-post' } },
      { field: 'leadgen', value: { leadgen_id: leadgenId, page_id: 'page-test', form_id: 'form-test', created_time: 1_795_000_000 } },
    ] }],
  };
}

function signedRequest(body: unknown, signatureValid = true) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', signatureValid ? appSecret : 'wrong-secret').update(raw).digest('hex')}`;
  return new NextRequest('https://example.test/api/leads/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
    body: raw,
  });
}

function mockGraph(body: unknown, status = 200) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /^https:\/\/graph\.facebook\.com\//);
    assert.equal(init?.headers && new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
    assert.equal(String(input).includes(token), false, 'token must not appear in URL');
    return Response.json(body, { status });
  }) as typeof fetch;
}

function graphLead(leadgenId: string, email: string, phone = '') {
  return { id: leadgenId, form_id: 'form-test', field_data: [
    { name: 'full_name', values: ['Lead Test Customer'] },
    { name: 'email', values: [email] },
    { name: 'phone_number', values: [phone] },
    { name: 'company_name', values: ['Test Furniture Ltd'] },
    { name: 'country', values: ['Sweden'] },
    { name: 'order_quantity', values: ['100-500'] },
    { name: 'compressed_sofa', values: ['Yes'] },
  ] };
}

async function cleanup(leadgenId: string, customerId?: string) {
  await db.metaLeadEvent.deleteMany({ where: { leadgenId } });
  if (customerId) {
    await db.stageHistory.deleteMany({ where: { customerId } });
    await db.customer.delete({ where: { id: customerId } });
  }
}

test('Meta Lead Ads webhook persists and deduplicates real events', async t => {
  const originalSecret = process.env.META_APP_SECRET;
  const originalToken = process.env.META_PAGE_ACCESS_TOKEN;
  process.env.META_APP_SECRET = appSecret;
  process.env.META_PAGE_ACCESS_TOKEN = token;
  try {
    await t.test('valid signature with empty entry returns 200 without DB writes', async () => {
      const beforeEvents = await db.metaLeadEvent.count();
      const beforeCustomers = await db.customer.count();
      const response = await POST(signedRequest({ object: 'page', entry: [] }));
      assert.equal(response.status, 200);
      assert.equal(await db.metaLeadEvent.count(), beforeEvents);
      assert.equal(await db.customer.count(), beforeCustomers);
    });

    await t.test('invalid signature returns 401 without DB writes', async () => {
      const leadgenId = `bad-${randomUUID()}`;
      const beforeCustomers = await db.customer.count();
      const response = await POST(signedRequest(payload(leadgenId), false));
      assert.equal(response.status, 401);
      assert.equal(await db.metaLeadEvent.findUnique({ where: { leadgenId } }), null);
      assert.equal(await db.customer.count(), beforeCustomers);
    });

    await t.test('Graph success creates Customer and CREATED event', async () => {
      const leadgenId = `new-${randomUUID()}`;
      const email = `${leadgenId}@example.test`;
      mockGraph(graphLead(leadgenId, email));
      let customerId: string | undefined;
      try {
        const response = await POST(signedRequest(payload(leadgenId)));
        const event = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId } });
        assert.equal(response.status, 200, event.error);
        customerId = event.customerId ?? undefined;
        assert.equal(event.status, 'CREATED');
        assert.ok(customerId);
        const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
        assert.equal(customer.source, 'FACEBOOK');
        assert.equal(customer.sourceDetail, 'Facebook Ads');
        assert.equal(customer.stage, 'NEW');
        assert.equal(customer.email, email);
        assert.equal(customer.companyName, 'Test Furniture Ltd');
        assert.equal(customer.country, 'Sweden');
        assert.equal(customer.quantity, 500);
      } finally {
        await cleanup(leadgenId, customerId);
      }
    });

    await t.test('existing email and phone link to one Customer', async () => {
      const leadgenId = `linked-${randomUUID()}`;
      const email = `${leadgenId}@example.test`;
      const customer = await db.customer.create({ data: { name: 'Existing lead', ownerId: (await db.user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id, email, phone: '+46701234567' } });
      mockGraph(graphLead(leadgenId, email, '+46701234567'));
      try {
        const response = await POST(signedRequest(payload(leadgenId)));
        assert.equal(response.status, 200);
        const event = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId } });
        assert.equal(event.status, 'LINKED');
        assert.equal(event.customerId, customer.id);
        assert.equal(await db.customer.count({ where: { email } }), 1);
      } finally {
        await cleanup(leadgenId, customer.id);
      }
    });

    await t.test('Graph failure leaves FAILED event with HTTP status and Meta code', async () => {
      const leadgenId = `failed-${randomUUID()}`;
      mockGraph({ error: { message: 'Missing leads_retrieval permission', code: 200 } }, 403);
      try {
        const response = await POST(signedRequest(payload(leadgenId)));
        assert.equal(response.status, 503);
        const event = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId } });
        assert.equal(event.status, 'FAILED');
        assert.match(event.error, /HTTP 403 code 200/);
        assert.equal(event.customerId, null);
        assert.equal(event.error.includes(token), false);
      } finally {
        await cleanup(leadgenId);
      }
    });

    await t.test('simultaneous and repeated webhook never creates a second Customer', async () => {
      const leadgenId = `repeat-${randomUUID()}`;
      const email = `${leadgenId}@example.test`;
      let customerId: string | undefined;
      globalThis.fetch = (async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return Response.json(graphLead(leadgenId, email));
      }) as typeof fetch;
      try {
        const statuses = await Promise.all([POST(signedRequest(payload(leadgenId))), POST(signedRequest(payload(leadgenId)))]);
        const firstEvent = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId } });
        assert.ok(statuses.some(response => response.status === 200), firstEvent.error);
        assert.ok(statuses.every(response => response.status === 200 || response.status === 503));
        const retry = await POST(signedRequest(payload(leadgenId)));
        assert.equal(retry.status, 200);
        const event = await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId } });
        customerId = event.customerId ?? undefined;
        assert.equal(event.status, 'CREATED');
        assert.equal(await db.customer.count({ where: { email } }), 1);
      } finally {
        await cleanup(leadgenId, customerId);
      }
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (originalSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalSecret;
    if (originalToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
    else process.env.META_PAGE_ACCESS_TOKEN = originalToken;
    await db.$disconnect();
  }
});
