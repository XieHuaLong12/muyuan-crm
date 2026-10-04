import { deleteTestCustomers } from './identity-test-cleanup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { normalizeWhatsApp } from '../lib/whatsapp';
import { saveCustomer } from '../services/customer-service';

test('WhatsApp号码标准化：保留国家码并移除格式字符', () => {
  assert.equal(normalizeWhatsApp('+966 50 123 4567'), '966501234567');
  assert.equal(normalizeWhatsApp('00966-50-123-4567'), '966501234567');
  assert.equal(normalizeWhatsApp('(971) 50 123 4567'), '971501234567');
  assert.equal(normalizeWhatsApp(''), '');
  assert.equal(normalizeWhatsApp(undefined), '');
});

test('AI/WhatsApp基础模型：客户标准化号码、消息和智能画像可关联保存', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: 'ADMIN' as const };
  let customerId = '';

  try {
    const customer = await saveCustomer(
      {
        name: 'WhatsApp Foundation Test',
        ownerId: admin.id,
        whatsapp: '+999 88 776 655 441',
        source: 'WHATSAPP',
      },
      actor
    );
    customerId = customer.id;

    assert.equal(customer.whatsappNormalized, '99988776655441');
    assert.equal(customer.aiScore, 0);
    assert.equal(customer.aiPriority, 'UNRANKED');

    const message = await db.whatsAppMessage.create({
      data: {
        customerId,
        waMessageId: `test-${customerId}`,
        waId: '99988776655441',
        direction: 'INBOUND',
        messageType: 'TEXT',
        content: 'Please quote 30 pcs.',
        sentAt: new Date(),
        raw: '{"test":true}',
      },
    });

    const intelligence = await db.customerIntelligence.create({
      data: {
        customerId,
        score: 88,
        priority: 'HIGH',
        intent: 'HIGH',
        customerType: 'IMPORTER',
        productsJson: '["Y-601"]',
        quantity: 30,
        currentNeed: 'FOB quotation',
        nextAction: 'Ask destination port',
        reason: '明确型号、数量并主动询价',
        confidence: 92,
        analyzedAt: new Date(),
      },
    });

    assert.equal(message.customerId, customerId);
    assert.equal(intelligence.customerId, customerId);
    assert.equal(intelligence.score, 88);

    const linked = await db.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { whatsappMessages: true, intelligence: true },
    });

    assert.equal(linked.whatsappMessages.length, 1);
    assert.equal(linked.intelligence?.priority, 'HIGH');
  } finally {
    if (customerId) {
      await db.whatsAppMessage.deleteMany({ where: { customerId } });
      await db.customerIntelligence.deleteMany({ where: { customerId } });
      await db.stageHistory.deleteMany({ where: { customerId } });
      await deleteTestCustomers({ where: { id: customerId } });
    }
    await db.$disconnect();
  }
});
