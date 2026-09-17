import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWhatsAppMessageText } from '../services/whatsapp-webhook-service';

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
