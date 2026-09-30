import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { communicationHistory,communicationHistoryQuery } from '../services/communication-history-service';

test('沟通档案筛选参数限制无效页码', () => {
  assert.equal(communicationHistoryQuery.safeParse({ page: 0 }).success, false);
  assert.equal(communicationHistoryQuery.safeParse({ q: 'x'.repeat(101) }).success, false);
});

test('沟通档案只显示有消息的客户，按真实消息时间排序并可翻阅', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: 'ADMIN' as const };
  const marker = randomUUID();
  const customers = [
    await db.customer.create({ data: { name: `History Alpha ${marker}`, ownerId: admin.id } }),
    await db.customer.create({ data: { name: `History Beta ${marker}`, ownerId: admin.id } }),
    await db.customer.create({ data: { name: `History Empty ${marker}`, ownerId: admin.id } }),
  ];
  const [alpha, beta] = customers;

  try {
    await db.whatsAppMessage.createMany({ data: [
      ...Array.from({ length: 52 }, (_, index) => ({ customerId: alpha.id, direction: 'INBOUND',
        content: `Archived ${index}`, source: 'whatsapp_web', status: 'RECEIVED', raw: '{}',
        sentAt: new Date(Date.UTC(2026, 0, 1, 0, index)) })),
      { customerId: beta.id, direction: 'OUTBOUND', content: 'Latest record', source: 'whatsapp_web',
        status: 'SENT', raw: '{}', sentAt: new Date('2026-01-02T00:00:00.000Z') },
    ] });

    const archive = await communicationHistory(actor, { q: marker });
    assert.equal(archive.total, 2);
    assert.deepEqual(archive.conversations.map(item => item.id), [beta.id, alpha.id]);
    assert.equal(archive.conversations[0].lastMessage?.content, 'Latest record');
    assert.equal(archive.selected?.id, beta.id);

    const first = await communicationHistory(actor, { q: marker, customer: alpha.id });
    assert.equal(first.messages.length, 50);
    assert.equal(first.messages.at(-1)?.content, 'Archived 51');
    assert.ok(first.nextCursor);
    const older = await communicationHistory(actor, { q: marker, customer: alpha.id, before: first.nextCursor });
    assert.deepEqual(older.messages.map(message => message.content), ['Archived 0', 'Archived 1']);
    assert.equal(older.nextCursor, null);
    assert.equal(older.viewingOlder, true);

    const otherSales = { ...actor, id: 'another-sales-user', role: 'SALES' as const };
    assert.equal((await communicationHistory(otherSales, { q: marker })).total, 0);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: beta.id } })).lastWhatsAppAt, null);
  } finally {
    await db.whatsAppMessage.deleteMany({ where: { customerId: { in: customers.map(customer => customer.id) } } });
    await db.customer.deleteMany({ where: { id: { in: customers.map(customer => customer.id) } } });
  }
});
