import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { ingestWhatsAppWebhook } from '../services/whatsapp-webhook-service';
import { acceptWebhookReceipt, retryWebhookReceipts } from '../services/webhook-receipt-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const message = (from: string, id: string, body: string) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
  metadata: { phone_number_id: 'retry-test-number' }, contacts: [{ wa_id: from, profile: { name: 'Retry Buyer' } }],
  messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }] } }] }] });

async function buyer(tag: string) {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const digits = `336${String(Date.now()).slice(-8)}`;
  const customer = await db.customer.create({ data: { name: `Retry ${tag}`, ownerId: admin.id, whatsapp: `+${digits}`, whatsappNormalized: digits, waId: digits, phoneE164: `+${digits}` } });
  return { customer, digits };
}

test('a customer message waits while the customer record is busy, instead of being lost', async () => {
  const tag = randomUUID().slice(0, 8);
  const { customer, digits } = await buyer(tag);
  let release!: () => void, locked!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), isLocked = new Promise<void>(resolve => { locked = resolve; });
  try {
    // Recomputing a customer's follow-up (outreach, tasks) locks their record and may hold it for seconds.
    const busy = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${customer.id} FOR UPDATE`;
      locked();
      await held;
    }, { timeout: 30_000 });
    await isLocked;
    const stored = ingestWhatsAppWebhook(message(digits, `wamid.busy.${tag}`, 'Tout simplement'));
    // Longer than a database transaction's default 5 seconds.
    await new Promise(resolve => setTimeout(resolve, 6_500));
    release();
    await busy;
    assert.equal((await stored).matchedCustomers, 1);
    assert.equal((await db.whatsAppMessage.findFirstOrThrow({ where: { waMessageId: `wamid.busy.${tag}` } })).content, 'Tout simplement');
  } finally {
    release();
    await deleteTestCustomers({ where: { id: customer.id } });
  }
});

test('webhooks that failed or stalled are processed again, at most five times, once per run', async () => {
  const tag = randomUUID().slice(0, 8);
  const { customer, digits } = await buyer(tag);
  const minutes = (n: number) => new Date(Date.now() - n * 60_000);
  const receipt = async (id: string, body: string, data: object) => {
    const receiptId = await acceptWebhookReceipt(message(digits, id, body), 'WHATSAPP');
    await db.syncJob.update({ where: { id: receiptId }, data });
    return receiptId;
  };
  const receipts: string[] = [];
  try {
    // The first attempt failed a few minutes ago (a busy database).
    receipts.push(await receipt(`wamid.failed.${tag}`, 'Bonjour je ne veux pas ça du tout', { status: 'FAILED', failed: 1, completedAt: minutes(3), error: 'WEBHOOK_PROCESSING_FAILED' }));
    // Accepted, then the server restarted before processing it.
    receipts.push(await receipt(`wamid.stalled.${tag}`, 'Le Tissus ok', { status: 'PENDING', startedAt: minutes(15) }));
    // Just accepted: its own processing may still be running.
    receipts.push(await receipt(`wamid.fresh.${tag}`, 'Ok', { status: 'PENDING' }));
    // Failed just now: tried again after a short wait, not at once.
    receipts.push(await receipt(`wamid.recent.${tag}`, 'Merci', { status: 'FAILED', failed: 1, completedAt: new Date() }));
    // Tried five times already.
    receipts.push(await receipt(`wamid.given-up.${tag}`, 'Hello', { status: 'FAILED', failed: 6, completedAt: minutes(30) }));

    // Two runs at once (two open tabs, or a tab and the scheduled job) process each receipt once.
    const runs = await Promise.all([retryWebhookReceipts(100), retryWebhookReceipts(100)]);
    const mine = (await db.syncJob.findMany({ where: { id: { in: receipts } }, select: { id: true, status: true, failed: true } }));
    const status = (id: string) => mine.find(r => r.id === id)!;
    assert.deepEqual(status(receipts[0]), { id: receipts[0], status: 'OK', failed: 2 });
    assert.deepEqual(status(receipts[1]), { id: receipts[1], status: 'OK', failed: 1 });
    assert.equal(status(receipts[2]).status, 'PENDING');
    assert.equal(status(receipts[3]).status, 'FAILED');
    assert.equal(status(receipts[4]).status, 'FAILED');
    assert.ok(runs.reduce((sum, run) => sum + run.retried, 0) >= 2);
    const shown = await db.whatsAppMessage.findMany({ where: { customerId: customer.id }, select: { content: true }, orderBy: { content: 'asc' } });
    assert.deepEqual(shown.map(m => m.content), ['Bonjour je ne veux pas ça du tout', 'Le Tissus ok']);
    // A receipt processed twice (it failed after storing its message) stores nothing twice.
    await db.syncJob.update({ where: { id: receipts[1] }, data: { status: 'FAILED', completedAt: minutes(5) } });
    await retryWebhookReceipts(100);
    assert.deepEqual(await db.syncJob.findUniqueOrThrow({ where: { id: receipts[1] }, select: { status: true, failed: true } }), { status: 'OK', failed: 2 });
    assert.equal(await db.whatsAppMessage.count({ where: { customerId: customer.id } }), 2);
  } finally {
    await db.syncJob.deleteMany({ where: { id: { in: receipts } } });
    await deleteTestCustomers({ where: { id: customer.id } });
  }
});
