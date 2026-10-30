import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { HttpError } from '../lib/auth';
import { asksPrice, polishProblems } from '../lib/reply-polish';
import { polishReply } from '../services/reply-polish-service';
import { deleteTestCustomers } from './identity-test-cleanup';

test('优化话术 rules: no numbers or prices the salesperson did not write, no Chinese for a foreign customer', () => {
  const chat = ['这是我们的产品目录，你先看一下是否有您喜欢的款式', "Je veux le prix d'un matelas 160*200"];
  assert.deepEqual(polishProblems("Voici notre catalogue, dites-moi quels modèles vous plaisent !", chat, false), []);
  assert.deepEqual(polishProblems('Pour le 160×200, voici le catalogue.', chat, false), [], 'numbers from the chat may stay');
  assert.match(polishProblems('Livraison en 25 jours.', chat, false)[0].zh, /加了原话和聊天里没有的数字（25）/);
  assert.deepEqual(polishProblems('Le prix est de 120 €.', chat, false).map(p => p.zh), ['加了原话和聊天里没有的数字（120），请核对', '写了价格，价格请用报价单']);
  assert.deepEqual(polishProblems('Voici notre 目录', chat, false).map(p => p.zh), ['里面有中文字符']);
  assert.deepEqual(polishProblems('这是目录', chat, true), [], 'a customer writing Chinese gets Chinese');

  for (const asked of ['je voulais juste savoir les prix des produits', 'How much for it', 'Combien ça coûte ?', 'كم السعر', '多少钱']) assert.equal(asksPrice(asked), true, asked);
  for (const other of ['Ok merci', '95470 Vémars', 'Hello']) assert.equal(asksPrice(other), false, other);
});

test('优化话术: three versions in the customer language, one retry when a version invents a number', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8);
  const customer = await db.customer.create({ data: { name: `Grand Julio ${tag}`, ownerId: admin.id, inquiryAt: new Date(), stage: 'REPLIED', country: 'France' } });
  await db.whatsAppMessage.create({ data: { customerId: customer.id, direction: 'INBOUND', content: "Bonjour, pour l'instant je voulais juste savoir les prix des produits.", sentAt: new Date(), raw: '{}', source: 'gupshup', status: 'RECEIVED' } });
  const originalFetch = globalThis.fetch, key = process.env.DEEPSEEK_API_KEY;
  const bodies: { temperature: number; context: Record<string, unknown> }[] = [];
  const answers = [
    [{ angle: '更自然', text: 'Voici notre catalogue 😊 Dites-moi quels modèles vous plaisent.', zh: '这是我们的目录 😊 告诉我你喜欢哪些款式。', why: '语气更自然' },
      { angle: '推动回复', text: 'Voici le catalogue. Livraison en 25 jours, quels modèles vous intéressent ?', zh: '这是目录。25 天交货，你对哪些型号感兴趣？', why: '用问题结尾' },
      { angle: '更专业', text: 'Je vous joins notre catalogue ; les prix dépendent du modèle et de la quantité.', zh: '附上目录；价格取决于型号和数量。', why: '说明价格怎么定' }],
    [{ angle: '更自然', text: 'Voici notre catalogue 😊 Dites-moi quels modèles vous plaisent.', zh: '这是我们的目录 😊 告诉我你喜欢哪些款式。', why: '语气更自然' },
      { angle: '推动回复', text: 'Voici le catalogue. Quels modèles vous intéressent pour le devis ?', zh: '这是目录。报价想看哪些型号？', why: '用问题结尾' },
      { angle: '更专业', text: 'Je vous joins notre catalogue ; les prix dépendent du modèle et de la quantité.', zh: '附上目录；价格取决于型号和数量。', why: '说明价格怎么定' }],
  ];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    bodies.push({ temperature: body.temperature, context: JSON.parse(body.messages[1].content) });
    const suggestions = answers[Math.min(bodies.length - 1, answers.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestions }) } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    delete process.env.DEEPSEEK_API_KEY;
    await assert.rejects(polishReply(actor, { customerId: customer.id, text: '这是目录' }), (e: unknown) => e instanceof HttpError && e.status === 503);
    process.env.DEEPSEEK_API_KEY = 'test-only-key';
    await assert.rejects(polishReply(actor, { customerId: customer.id, text: '  ' }), 'an empty input box');

    const result = await polishReply(actor, { customerId: customer.id, text: '这是我们的产品目录，你先看一下是否有您喜欢的款式' });
    assert.equal(bodies.length, 2, 'the invented "25 jours" got one retry');
    assert.match(String((bodies[1].context.fix as string[])[0]), /Version 2: .*\(25\)/);
    assert.deepEqual(result.suggestions.map(s => [s.angle, s.warnings]), [['更自然', []], ['推动回复', []], ['更专业', []]]);
    assert.equal(result.priceAsked, true, 'the customer asked for prices');
    assert.equal((bodies[0].context.customer as { scriptLanguage: string }).scriptLanguage, 'fr');

    // 换一批: the versions on screen go along to be avoided, with more freedom.
    bodies.length = 0;
    answers.splice(0, 1);
    await polishReply(actor, { customerId: customer.id, text: '这是目录', avoid: result.suggestions.map(s => s.text) });
    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies[0].context.avoid, result.suggestions.map(s => s.text));
    assert.equal(bodies[0].temperature, 0.9);

    // A version still wrong after the retry is shown with a warning, not hidden.
    bodies.length = 0;
    answers.splice(0, answers.length, [{ angle: '更直接', text: 'Le prix est de 120 € par pièce.', zh: '每件 120 欧元。', why: '直接报价' }]);
    const stubborn = await polishReply(actor, { customerId: customer.id, text: '这是目录' });
    assert.equal(bodies.length, 2);
    assert.deepEqual(stubborn.suggestions[0].warnings, ['加了原话和聊天里没有的数字（120），请核对', '写了价格，价格请用报价单']);
  } finally {
    globalThis.fetch = originalFetch;
    if (key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = key;
    await deleteTestCustomers({ where: { id: customer.id } });
    await db.$disconnect();
  }
});
