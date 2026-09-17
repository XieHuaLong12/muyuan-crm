import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import {
  completeWhatsAppEmbeddedSignup,
  decryptWhatsAppAccessToken,
  whatsappConnectionStatus,
} from '../services/whatsapp-connect-service';

test('WhatsApp Coexistence：授权码交换、WABA订阅和密钥加密保存', async () => {
  const originalFetch = globalThis.fetch;
  const old = {
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_EMBEDDED_SIGNUP_CONFIG_ID: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
    WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
  };
  process.env.META_APP_ID = '123456789';
  process.env.META_APP_SECRET = 'test-app-secret';
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = '987654321';
  process.env.META_GRAPH_VERSION = 'v26.0';
  process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';

  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'secret-test-access-token', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('/1122334455/subscribed_apps')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    if (url.includes('/6677889900?')) {
      return new Response(JSON.stringify({ display_phone_number: '+86 158 1569 4430', verified_name: 'Lvanju Furniture' }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: 'unexpected test URL' } }), { status: 500 });
  };

  try {
    await db.whatsAppIntegration.deleteMany({ where: { id: 'primary' } });
    const result = await completeWhatsAppEmbeddedSignup({
      code: 'test-authorization-code-1234567890',
      wabaId: '1122334455',
      phoneNumberId: '6677889900',
      businessId: '9988776655',
    });
    assert.equal(result.connection?.status, 'CONNECTED');
    assert.equal(result.connection?.connectionMode, 'COEXISTENCE');
    assert.equal(result.connection?.displayPhoneNumber, '+86 158 1569 4430');
    assert.ok(calls.some((call) => call.includes('/oauth/access_token')));
    assert.ok(calls.some((call) => call.includes('/1122334455/subscribed_apps')));

    const stored = await db.whatsAppIntegration.findUniqueOrThrow({ where: { id: 'primary' } });
    assert.ok(!stored.encryptedAccessToken.includes('secret-test-access-token'));
    assert.equal(decryptWhatsAppAccessToken(stored.encryptedAccessToken), 'secret-test-access-token');

    const publicStatus = await whatsappConnectionStatus();
    assert.equal(publicStatus.configured, true);
    assert.equal(JSON.stringify(publicStatus).includes('secret-test-access-token'), false);
    assert.equal(JSON.stringify(publicStatus).includes('test-app-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    await db.whatsAppIntegration.deleteMany({ where: { id: 'primary' } });
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.$disconnect();
  }
});
