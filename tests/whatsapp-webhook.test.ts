import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { extractWhatsAppMessageText, ingestWhatsAppWebhook } from '../services/whatsapp-webhook-service';

test('WhatsApp webhook: 提取文本消息', () => {
  assert.equal(
    extractWhatsAppMessageText({ type: 'text', text: { body: 'Hello, I need 30 pcs Y-601.' } }),
    'Hello, I need 30 pcs Y-601.'
  );
});

test('WhatsApp webhook: 提取图片、文件与交互回复', () => {
  assert.equal(
    extractWhatsAppMessageText({ type: 'image', image: { caption: 'Y-601 color' } }),
    'Y-601 color'
  );
  assert.equal(
    extractWhatsAppMessageText({ type: 'document', document: { filename: 'purchase-order.pdf' } }),
    '[文件] purchase-order.pdf'
  );
  assert.equal(
    extractWhatsAppMessageText({ type: 'interactive', interactive: { button_reply: { title: 'FOB price' } } }),
    'FOB price'
  );
});

test('WhatsApp webhook: 未支持的类型仍保留可读占位', () => {
  assert.equal(extractWhatsAppMessageText({ type: 'audio' }), '[语音/音频]');
  assert.equal(extractWhatsAppMessageText({ type: 'unknown_type' }), '[UNKNOWN_TYPE]');
});

test('WhatsApp Coexistence: 手机 Business App 发出的消息作为 OUTBOUND 入库', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const customer = await db.customer.create({
    data: {
      name: 'Coexistence Echo Test',
      ownerId: admin.id,
      whatsapp: '+49 151 2345 6789',
      whatsappNormalized: '4915123456789',
    },
  });
  try {
    const result = await ingestWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'smb_message_echoes',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ wa_id: '4915123456789', profile: { name: 'Buyer' } }],
            message_echoes: [{
              from: '8615815694430',
              to: '4915123456789',
              id: `wamid.echo.${customer.id}`,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text',
              text: { body: 'I will send you the FOB quotation today.' },
            }],
          },
        }],
      }],
    });
    assert.equal(result.outboundEchoes, 1);
    assert.equal(result.matchedCustomers, 1);
    const message = await db.whatsAppMessage.findUniqueOrThrow({ where: { waMessageId: `wamid.echo.${customer.id}` } });
    assert.equal(message.customerId, customer.id);
    assert.equal(message.direction, 'OUTBOUND');
    assert.equal(message.content, 'I will send you the FOB quotation today.');
    const updated = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    assert.ok(updated.lastOutboundAt);
  } finally {
    await db.whatsAppMessage.deleteMany({ where: { customerId: customer.id } });
    await db.customer.delete({ where: { id: customer.id } });
    await db.$disconnect();
  }
});
