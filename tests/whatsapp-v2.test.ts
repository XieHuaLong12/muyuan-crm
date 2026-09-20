import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { parseGupshup, statusPredecessors } from '../lib/gupshup';
import { ingestWhatsAppWebhook } from '../services/whatsapp-webhook-service';
import { sendWhatsAppMessage, listWhatsAppMessages } from '../services/whatsapp-message-service';
import { generateWhatsAppReply, ConversationAnalysis } from '../services/whatsapp-ai-service';
import { shouldApplyStage, updateWhatsAppStage } from '../services/whatsapp-stage-service';

const event = (id: string, phone = '15557770001', text = 'Please quote compressed sofa FOB price', timestamp = Date.now()) => ({
  app: 'TestApp', type: 'message', timestamp, version: 2,
  payload: { id, source: phone, type: 'text', sender: { phone, name: 'V2 Buyer' }, payload: { text } },
});
const analysis: ConversationAnalysis = { reply: 'Could you confirm model and quantity?', stage: 'QUOTED', confidence: 95, reason: '客户询价', evidence: 'FOB price', nextTask: { title:'Send quotation',type:'QUOTATION',dueInDays:1 } };

test('Gupshup V2: parses message milliseconds and prevents status regression', () => {
  const parsed = parseGupshup(event('message-1', undefined, undefined, 1750000000000));
  assert.equal(parsed.kind, 'message');
  if (parsed.kind === 'message') {
    assert.equal(parsed.sentAt.getTime(), 1750000000000);
    assert.equal(parsed.content, 'Please quote compressed sofa FOB price');
  }
  assert.throws(() => parseGupshup({ type: 'message', payload: {} }));
  assert.equal(parseGupshup({ type: 'user-event' }).kind, 'ignored');
  assert.ok(!statusPredecessors('SENT').includes('READ'));
  assert.ok(!statusPredecessors('FAILED').includes('DELIVERED'));
});

test('AI stage: protects terminal/manual stages, evidence and forward progression', () => {
  assert.equal(shouldApplyStage('NEW', analysis, 'FOB price'), true);
  for (const stage of ['WON', 'ORDER', 'LOST', 'PAUSED', 'INVALID', 'FOLLOW_UP']) assert.equal(shouldApplyStage(stage, analysis, 'FOB price'), false);
  assert.equal(shouldApplyStage('NEW', { ...analysis, confidence: 79 }, 'FOB price'), false);
  assert.equal(shouldApplyStage('NEW', analysis, 'Hello'), false);
});

test('WhatsApp V2 integration: ingestion, sends, receipts, scoped history and AI', async t => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: 'ADMIN' };
  const phone = `1555${String(Date.now()).slice(-7)}`;
  let customerId = '';
  const environment = { ...process.env };
  try {
    process.env.GUPSHUP_API_KEY = 'test-key'; process.env.GUPSHUP_SOURCE = '15550000000'; process.env.GUPSHUP_APP_NAME = 'TestApp';
    process.env.DEEPSEEK_API_KEY = 'test-ai';
    const id = randomUUID();
    const results = await Promise.all([ingestWhatsAppWebhook(event(id, phone)), ingestWhatsAppWebhook(event(id, phone))]);
    assert.equal(results.reduce((sum, r) => sum + r.createdCustomers, 0), 1);
    assert.equal(results.reduce((sum, r) => sum + r.duplicateMessages, 0), 1);
    const inbound = await db.whatsAppMessage.findUniqueOrThrow({ where: { waMessageId: id } });
    customerId = inbound.customerId;
    assert.equal(inbound.sender, phone); assert.equal(inbound.status, 'RECEIVED');
    const first = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    await ingestWhatsAppWebhook(event(randomUUID(), phone, 'Earlier', Date.now() - 86400000));
    const second = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    assert.equal(first.lastContactAt?.getTime(), second.lastContactAt?.getTime());
    await assert.rejects(listWhatsAppMessages(customerId, { ...actor, id: 'other-sales', role: 'SALES' }), /访问权限/);
    await assert.rejects(sendWhatsAppMessage({ customerId, content: 'Hi', requestId: randomUUID() }, { ...actor, id: 'other-sales', role: 'SALES' }), /访问权限/);
    let calls = 0;
    const providerId = randomUUID();
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
      calls++;
      assert.equal(String(url), 'https://api.gupshup.io/wa/api/v1/msg');
      assert.equal(new URLSearchParams(String(options?.body)).get('destination'), phone);
      return Response.json({ status: 'submitted', messageId: providerId });
    });
    const requestId = randomUUID();
    const sent = await sendWhatsAppMessage({ customerId, content: 'Hello buyer', requestId }, actor);
    assert.equal(sent.message.status, 'SENT');
    const repeated = await sendWhatsAppMessage({ customerId, content: 'Hello buyer', requestId }, actor);
    assert.equal(repeated.message.id, sent.message.id); assert.equal(calls, 1);
    await assert.rejects(sendWhatsAppMessage({ customerId, content: 'Different', requestId }, actor), /编号已使用/);
    const receipt = (type: string) => ({ type: 'message-event', payload: { id: 'wamid-'+id, gsId: providerId, type } });
    await ingestWhatsAppWebhook(receipt('read')); await ingestWhatsAppWebhook(receipt('sent'));
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: sent.message.id } })).status, 'READ');
    fetchMock.mock.mockImplementation(async () => Response.json({ status: 'error' }, { status: 400 }));
    assert.equal((await sendWhatsAppMessage({ customerId, content: 'Failed', requestId: randomUUID() }, actor)).message.status, 'FAILED');
    fetchMock.mock.mockImplementation(async () => { throw new Error('timeout'); });
    const unknownId = randomUUID();
    assert.equal((await sendWhatsAppMessage({ customerId, content: 'Timeout', requestId: unknownId }, actor)).message.status, 'UNKNOWN');
    const count = fetchMock.mock.callCount();
    await sendWhatsAppMessage({ customerId, content: 'Timeout', requestId: unknownId }, actor);
    assert.equal(fetchMock.mock.callCount(), count);
    await db.customer.update({ where: { id: customerId }, data: { lastInboundAt: new Date(Date.now() - 2 * 86400000) } });
    await assert.rejects(sendWhatsAppMessage({ customerId, content: 'Expired', requestId: randomUUID() }, actor), /24 小时/);
    for (let i = 0; i < 52; i++) await db.whatsAppMessage.create({ data: { customerId, waMessageId: randomUUID(), direction: 'INBOUND',
      content: `Message ${i} FOB price`, sentAt: new Date(Date.now() + i), raw: '{}' } });
    const page1 = await listWhatsAppMessages(customerId, actor);
    assert.equal(page1.messages.length, 50); assert.ok(page1.nextCursor);
    const page2 = await listWhatsAppMessages(customerId, actor, page1.nextCursor!);
    assert.ok(page2.messages.length > 0);
    assert.ok(!page2.messages.some(m => page1.messages.some(n => n.id === m.id)));
    fetchMock.mock.mockImplementation(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      const context = JSON.parse(request.messages[1].content);
      assert.equal(context.messages.length, 20);
      assert.equal('phone' in context.customer, false);
      return Response.json({ choices: [{ message: { content: JSON.stringify(analysis) } }] });
    });
    const reply = await generateWhatsAppReply(customerId, actor);
    assert.equal(reply.reply, analysis.reply);
    await updateWhatsAppStage(customerId);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).stage, 'QUOTED');
    assert.equal(await db.stageHistory.count({ where: { customerId, changedBy: 'AI:DeepSeek' } }), 1);
    await updateWhatsAppStage(customerId);
    assert.equal(await db.task.count({where:{customerId,source:'AI',type:'QUOTATION'}}),1);
    assert.equal(await db.stageHistory.count({ where: { customerId, changedBy: 'AI:DeepSeek' } }), 1);
  } finally {
    for (const key of ['GUPSHUP_API_KEY', 'GUPSHUP_SOURCE', 'GUPSHUP_APP_NAME', 'DEEPSEEK_API_KEY']) {
      if (environment[key] === undefined) delete process.env[key]; else process.env[key] = environment[key];
    }
    if (customerId) {
      await db.whatsAppMessage.deleteMany({ where: { customerId } });
      await db.stageHistory.deleteMany({ where: { customerId } });
      await db.customer.delete({ where: { id: customerId } });
    }
    await db.$disconnect();
  }
});
