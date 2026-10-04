import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server';
import { GET, HEAD, POST } from '../app/api/whatsapp/webhook/route';
import { db } from '../lib/db';
import { processWebhookReceipt } from '../services/webhook-receipt-service';

const request = (payload: unknown, secret?: string) => new NextRequest('https://crm.example/api/whatsapp/webhook', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) }, body: JSON.stringify(payload),
});
const emptyResponse = async (response: Response, status: number) => {
  assert.equal(response.status, status); assert.equal((await response.arrayBuffer()).byteLength, 0);
};

test('webhook probes are empty and Meta challenge verification remains compatible', async () => {
  const old = process.env.WHATSAPP_VERIFY_TOKEN;
  try {
    process.env.WHATSAPP_VERIFY_TOKEN = 'fixture-verify';
    await emptyResponse(await GET(new NextRequest('https://crm.example/api/whatsapp/webhook')), 204);
    await emptyResponse(await HEAD(), 204);
    const verified = await GET(new NextRequest('https://crm.example/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=fixture-verify&hub.challenge=12345'));
    assert.equal(verified.status, 200); assert.equal(await verified.text(), '12345');
    await emptyResponse(await GET(new NextRequest('https://crm.example/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345')), 204);
  } finally { if (old === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN; else process.env.WHATSAPP_VERIFY_TOKEN = old; }
});

test('POST persists evidence, acknowledges empty before work, retains failures and preserves authentication', async t => {
  const keys = ['GUPSHUP_WEBHOOK_SECRET', 'GUPSHUP_APP_NAME', 'GUPSHUP_SOURCE_NUMBER', 'GUPSHUP_APP_ID', 'META_APP_SECRET', 'DEEPSEEK_API_KEY'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const callbacks: Array<() => Promise<unknown>> = [];
  t.mock.method(createRequire(import.meta.url)('next/server'), 'after', (callback: () => Promise<unknown>) => { callbacks.push(callback); });
  const marker = randomUUID(), kind = `fixture-${marker}`;
  const payload = { app: 'PROBE_TEST', type: kind, payload: {} };
  const receipts: string[] = [];
  try {
    process.env.GUPSHUP_WEBHOOK_SECRET = 'fixture-secret'; process.env.GUPSHUP_APP_NAME = 'PROBE_TEST';
    process.env.GUPSHUP_SOURCE_NUMBER = '+19195550101'; process.env.GUPSHUP_APP_ID = 'fixture-app';
    process.env.META_APP_SECRET = 'fixture-cloud-secret'; delete process.env.DEEPSEEK_API_KEY;
    await emptyResponse(await POST(request(payload)), 401);
    await emptyResponse(await POST(request(payload, 'wrong')), 401);
    await emptyResponse(await POST(request({ ...payload, app: 'other' }, 'fixture-secret')), 400);
    await emptyResponse(await POST(request({ app: 'PROBE_TEST', type: 'message', payload: {} }, 'fixture-secret')), 400);
    const v3 = { object: 'whatsapp_business_account', gs_app_id: 'fixture-app', entry: [{ changes: [{ field: 'messages', value: { metadata: { display_phone_number: '+19195550202' } } }] }] };
    await emptyResponse(await POST(request(v3, 'fixture-secret')), 400);
    await emptyResponse(await POST(request({ ...v3, gs_app_id: 'another-app' }, 'fixture-secret')), 400);
    const cloud = { object: 'whatsapp_business_account', entry: [] };
    await emptyResponse(await POST(request(cloud)), 401);
    const unsignedLead = { object: 'page', entry: [{ changes: [{ field: 'leadgen', value: {} }] }] };
    await emptyResponse(await POST(request(unsignedLead)), 401);
    await emptyResponse(await POST(new NextRequest('https://crm.example/api/whatsapp/webhook', { method: 'POST', body: 'not-json' })), 400);
    await emptyResponse(await POST(new NextRequest('https://crm.example/api/whatsapp/webhook', { method: 'POST', headers: { 'content-length': '1048577' }, body: '{}' })), 413);
    assert.equal(callbacks.length, 0, 'rejected requests never schedule processing');

    await emptyResponse(await POST(request(payload, 'fixture-secret')), 200);
    assert.equal(callbacks.length, 1);
    const receipt = await db.syncJob.findFirstOrThrow({ where: { jobType: 'WEBHOOK_INBOX', detail: { path: '$.payload.type', equals: kind } } });
    receipts.push(receipt.id); assert.equal(receipt.status, 'PENDING');
    assert.ok(!JSON.stringify(receipt.detail).includes('fixture-secret'), 'headers and credentials are not persisted');
    await callbacks.shift()!();
    assert.equal((await db.syncJob.findUniqueOrThrow({ where: { id: receipt.id } })).status, 'OK');

    // A valid Cloud signature keeps the original Cloud path available.
    const raw = JSON.stringify(cloud);
    await emptyResponse(await POST(new NextRequest('https://crm.example/api/whatsapp/webhook', { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'fixture-cloud-secret').update(raw).digest('hex')}` }, body: raw })), 200);
    assert.equal(callbacks.length, 1); await callbacks.shift()!();

    // Force an ingestion validation failure after acceptance; the authenticated evidence remains durable.
    const failure = await db.syncJob.create({ data: { provider: 'GUPSHUP', jobType: 'WEBHOOK_INBOX', status: 'PENDING', detail: { kind: 'WHATSAPP', payload: { app: 'PROBE_TEST', type: 'message', payload: {} } } } });
    receipts.push(failure.id); await processWebhookReceipt(failure.id);
    const failed = await db.syncJob.findUniqueOrThrow({ where: { id: failure.id } });
    assert.equal(failed.status, 'FAILED'); assert.equal(failed.error, 'WEBHOOK_PROCESSING_FAILED'); assert.ok(failed.detail);
    delete process.env.GUPSHUP_WEBHOOK_SECRET;
    await emptyResponse(await POST(request(payload, 'fixture-secret')), 503);
  } finally {
    await db.syncJob.deleteMany({ where: { id: { in: receipts } } });
    for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
  }
});
