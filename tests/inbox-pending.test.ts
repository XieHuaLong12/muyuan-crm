import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { inboxConversations } from '../services/inbox-service';
import { fillVariables, firstNameOf, firstTouchTemplate, listTemplates, productLineOf, sendTemplateMessage, variableSources, type ApprovedTemplate, type TemplateFacts } from '../services/whatsapp-template-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const business = '+19195550404';
const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const template = (id: string, name: string, language = 'en', body = "Hi {{1}}, it's {{2}} from LVANJU, the factory behind the Facebook ad for {{3}}."): ApprovedTemplate =>
  ({ id, name, language, category: 'UTILITY', body, variables: (body.match(/\{\{\d\}\}/g) ?? []).length });
const sources = (body: string) => variableSources(body, (body.match(/\{\{\d\}\}/g) ?? []).length).map(v => v.source);

async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>) {
  const saved = { ...process.env };
  Object.assign(process.env, values);
  try { return await run(); } finally { for (const key of Object.keys(values)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

test('first-touch greeting: first name, product line and the template for the lead source', () => {
  assert.equal(firstNameOf('MUHAMMAD ANAS'), 'Muhammad');
  assert.equal(firstNameOf('  sophie martin'), 'Sophie');
  assert.equal(firstNameOf('McKenzie Lee'), 'McKenzie', 'mixed case is kept as typed');
  assert.equal(firstNameOf('أيمن الشريف'), 'أيمن');
  assert.equal(firstNameOf('+966 539 116 825'), '', 'a number is not a name');

  assert.equal(productLineOf('Sofa_SA_Oct'), 'compressed sofas');
  assert.equal(productLineOf('Matelas_FR_IG'), 'vacuum-packed mattresses');
  assert.equal(productLineOf('SmartBed_AU', 'Smart adjustable mattress'), 'smart electric mattresses', 'electric is checked before mattress');
  assert.equal(productLineOf('Smart_Sofa_Promo'), 'compressed sofas', '"smart" alone does not mean the electric line');
  assert.equal(productLineOf('LVANJU_Catalog_AE', 'not_sure_yet,_send_me_the_full_catalog'), '');

  const lead = { source: 'FACEBOOK', language: '' };
  const approved = [template('t-first', 'lvanju_first_fb_en'), template('t-hi', 'lvanju_hi_fb_en'), template('t-ig', 'lvanju_hi_ig_en'), template('t-other', 'follow_up_general')];
  assert.equal(firstTouchTemplate(lead, approved)?.id, 't-hi');
  assert.equal(firstTouchTemplate(lead, approved.filter(t => t.id !== 't-hi'))?.id, 't-first', 'the first version until the v2 greeting is approved');
  assert.equal(firstTouchTemplate({ ...lead, source: 'INSTAGRAM' }, approved)?.id, 't-ig');
  assert.equal(firstTouchTemplate({ ...lead, source: 'WEBSITE' }, approved), null, 'only ad leads from Facebook and Instagram get a greeting');
  assert.equal(firstTouchTemplate({ source: 'FACEBOOK', language: 'fr' }, [...approved, template('t-hi-fr', 'lvanju_hi_fb_fr', 'fr')])?.id, 't-hi-fr', "the customer's language first");
});

test('template variables: what each one stands for is read from the words around it', () => {
  assert.deepEqual(sources("Hi {{1}}, it's {{2}} from LVANJU, the factory behind the Facebook ad for {{3}}."), ['firstName', 'owner', 'productLine']);
  assert.deepEqual(sources('Hi {{1}}, {{2}} here from LVANJU, the factory behind the Instagram ad for {{3}}.'), ['firstName', 'owner', 'productLine']);
  assert.deepEqual(sources("Hi {{1}}, it's {{2}} from LVANJU Furniture. You left your details on our Facebook ad about {{3}}, so I'm following up."), ['firstName', 'owner', 'productLine']);
  assert.deepEqual(sources("Hi {{1}}, it's {{2}} from LVANJU. Just following up on quotation {{3}} for {{4}} I sent you."), ['firstName', 'owner', 'quoteNo', 'productLine']);
  assert.deepEqual(sources('Hi {{1}}, good news: your order {{2}} has been shipped. The estimated delivery date is {{3}}.'), ['firstName', 'orderNo', 'eta']);
  assert.deepEqual(sources("Bonjour {{1}}, c'est {{2}} de LVANJU. Vous avez laissé vos coordonnées via notre publicité Facebook pour {{3}}."), ['firstName', 'owner', 'productLine']);
  assert.deepEqual(sources("Hi {{1}}, we'll be showing our new sofas at {{2}} next month."), ['firstName', null], 'a variable the words do not describe is left to the salesperson');
  assert.deepEqual(variableSources('Hi {{1}}, it is {{2}}.', 2)[0], { source: 'firstName', context: 'Hi ___, it is ….' });
});

test('template variables: filled from the customer record, with where each value came from or why it is empty', () => {
  const facts: TemplateFacts = { name: 'AHMED HASSAN', owner: 'Jason', productLine: 'compressed sofas', quote: { number: 'Q-20261012-03', sentAt: '10/12 发出' }, order: null };
  const quote = fillVariables(template('t-q', 'lvanju_quote_followup_en', 'en', "Hi {{1}}, it's {{2}} from LVANJU. Just following up on quotation {{3}} for {{4}} I sent you."), facts);
  assert.deepEqual(quote.map(f => f.value), ['Ahmed', 'Jason', 'Q-20261012-03', 'compressed sofas']);
  assert.deepEqual(quote.map(f => f.label), ['客户名', '负责销售', '报价单号', '产品线']);
  assert.match(quote[2].note, /最近一份已发出的报价单/);

  const shipped = template('t-o', 'lvanju_order_shipped_en', 'en', 'Hi {{1}}, your order {{2}} has been shipped. The estimated delivery date is {{3}}.');
  const noOrder = fillVariables(shipped, facts);
  assert.deepEqual(noOrder.map(f => f.value), ['Ahmed', '', '']);
  assert.match(noOrder[1].note, /还没有订单/);
  const noDate = fillVariables(shipped, { ...facts, order: { number: 'LV-1017', eta: '' } });
  assert.deepEqual(noDate.map(f => f.value), ['Ahmed', 'LV-1017', '']);
  assert.match(noDate[2].note, /LV-1017 还没有填预计送达日期/);
  assert.deepEqual(fillVariables(shipped, { ...facts, order: { number: 'LV-1017', eta: 'November 20, 2026' } }).map(f => f.value), ['Ahmed', 'LV-1017', 'November 20, 2026']);

  const unknown = fillVariables(template('t-e', 'lvanju_event_invite_en', 'en', 'Hi {{1}}, see you at {{2}} next month.'), facts)[1];
  assert.deepEqual([unknown.source, unknown.label, unknown.value], [null, '未识别', '']);
  // Product line names are English: a French template leaves that variable to the salesperson.
  const french = fillVariables(template('t-fr', 'lvanju_hi_fb_fr', 'fr', "Bonjour {{1}}, c'est {{2}} de LVANJU, la publicité Facebook pour {{3}}."), facts);
  assert.deepEqual(french.map(f => f.value), ['Ahmed', 'Jason', '']);
  assert.match(french[2].note, /英文/);
});

test('待首联: assigned customers nobody has contacted, own only for salespeople, most urgent first, gone once greeted', async t => {
  const marker = `Pending${randomUUID().slice(0, 6)}`;
  const [admin, sales, other] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }),
    db.user.create({ data: { name: `${marker} Seller`, email: `${marker}-a@example.com`, role: 'SALES', passwordHash: hashPassword('x') } }),
    db.user.create({ data: { name: `${marker} Other`, email: `${marker}-b@example.com`, role: 'SALES', passwordHash: hashPassword('x') } }),
  ]);
  const me = actorOf(sales), adminActor = actorOf(admin);
  const at = (minutes: number) => new Date(Date.now() + minutes * 60000);
  const phone = `+9665${String(Date.now()).slice(-8)}`;
  const lead = (name: string, ownerId: string, data: Record<string, unknown> = {}) => db.customer.create({ data: { name: `${marker} ${name}`, ownerId, source: 'FACEBOOK',
    sourceDetail: 'Sofa_SA_Oct', assignedAt: at(-30), firstContactDueAt: at(60), ...data } });
  const names = (rows: { name: string }[]) => rows.map(row => row.name.slice(marker.length + 1));
  try {
    const soon = await lead('Soon', sales.id, { firstContactDueAt: at(4), leadGrade: 'A', whatsapp: phone, phone, phoneE164: phone, whatsappNormalized: phone.slice(1), contactKeysAt: new Date() });
    await Promise.all([
      lead('Late', sales.id, { firstContactDueAt: at(-15), leadGrade: 'B' }),
      lead('Later', sales.id, { firstContactDueAt: at(600), leadGrade: 'C' }),
      lead('Contacted', sales.id, { firstContactAt: at(-5), lastOutboundAt: at(-5) }),
      lead('Pool', sales.id, { firstContactDueAt: null, pendingAssignment: true }),
      lead('Lost', sales.id, { stage: 'LOST' }),
      lead('Foreign', other.id),
    ]);

    // Customers without a single message are listed: that is the point of the queue.
    const mine = await inboxConversations(me, { filter: 'pending', q: marker });
    assert.deepEqual(names(mine.pending), ['Late', 'Soon', 'Later'], 'late first, then a good form due soon');
    assert.equal(mine.pendingTotal, 3); assert.equal(mine.conversations.length, 0);
    assert.equal((await inboxConversations(me, { q: marker })).pendingTotal, 3, 'the chip count shows on every filter');
    assert.equal((await inboxConversations(me, { filter: 'pending', q: marker, ownerId: other.id })).pending.length, 3, 'salespeople cannot widen their scope');
    assert.deepEqual(names((await inboxConversations(adminActor, { filter: 'pending', q: marker })).pending).sort(), ['Foreign', 'Late', 'Later', 'Soon']);
    assert.deepEqual(names((await inboxConversations(adminActor, { filter: 'pending', q: marker, ownerId: other.id })).pending), ['Foreign']);

    await withEnv({ GUPSHUP_SOURCE_NUMBER: business, GUPSHUP_APP_NAME: 'PENDING_TEST', GUPSHUP_API_KEY: 'pending-key', GUPSHUP_APP_ID: `app-${marker}` }, async () => {
      t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
        const url = String(input);
        if (url === `https://api.gupshup.io/wa/app/app-${marker}/template`) return Response.json({ status: 'success', templates: [
          { id: 'tpl-first', elementName: 'lvanju_first_fb_en', languageCode: 'en', category: 'MARKETING', status: 'APPROVED', templateType: 'TEXT', data: 'Hi {{1}}, it is {{2}} about {{3}}.' },
          { id: 'tpl-hi', elementName: 'lvanju_hi_fb_en', languageCode: 'en', category: 'UTILITY', status: 'APPROVED', templateType: 'TEXT', data: 'Hi {{1}}, {{2}} here, the factory behind the ad for {{3}}.' },
          { id: 'tpl-quote', elementName: 'lvanju_quote_followup_en', languageCode: 'en', category: 'UTILITY', status: 'APPROVED', templateType: 'TEXT', data: 'Hi {{1}}, following up on quotation {{2}}.' },
          { id: 'tpl-shipped', elementName: 'lvanju_order_shipped_en', languageCode: 'en', category: 'UTILITY', status: 'APPROVED', templateType: 'TEXT', data: 'Your order {{1}} has been shipped. The estimated delivery date is {{2}}.' }] });
        if (url === 'https://api.gupshup.io/wa/api/v1/template/msg') return Response.json({ status: 'submitted', messageId: `gs-${marker}` });
        return new Response('unexpected', { status: 500 });
      });
      const list = await listTemplates(me, { customerId: soon.id, refresh: '1' });
      assert.deepEqual(list.suggestion, { templateId: 'tpl-hi' });
      const params = list.fills['tpl-hi'].map(f => f.value);
      assert.deepEqual(params, [marker, `${marker} Seller`, 'compressed sofas']);
      const sent = await sendTemplateMessage({ customerId: soon.id, templateId: 'tpl-hi', params, requestId: randomUUID() }, me);
      assert.equal(sent.message.content, `Hi ${marker}, ${marker} Seller here, the factory behind the ad for compressed sofas.`);
      // The greeting is the first contact: the customer leaves 待首联 and gets no greeting suggested again.
      assert.deepEqual(names((await inboxConversations(me, { filter: 'pending', q: marker })).pending), ['Late', 'Later']);
      const after = await listTemplates(me, { customerId: soon.id });
      assert.equal(after.suggestion, null);
      assert.deepEqual(after.fills['tpl-hi'].map(f => f.value), params, 'contacted customers still get every template filled in');

      // A customer further along: the latest sent quotation and the latest order fill their variables.
      await db.quotation.create({ data: { customerId: soon.id, quoteNumber: `${marker}-Q1`, product: 'Y-602', quantity: 100, unitPrice: 86, currency: 'USD', incoterm: 'FOB',
        notes: '', createdBy: sales.id, status: 'SENT', sentAt: at(-60 * 24) } });
      await db.quotation.create({ data: { customerId: soon.id, quoteNumber: `${marker}-Q2`, product: 'Y-602', quantity: 100, unitPrice: 80, currency: 'USD', incoterm: 'FOB',
        notes: '', createdBy: sales.id } });
      await db.order.create({ data: { customerId: soon.id, orderNo: `${marker}-O1`, amountRMB: 50000, notes: '', createdBy: sales.id, estimatedDelivery: new Date('2026-11-20T04:00:00Z') } });
      const later = await listTemplates(me, { customerId: soon.id });
      assert.deepEqual(later.fills['tpl-quote'].map(f => f.value), [marker, `${marker}-Q1`], 'a draft quotation is never quoted to the customer');
      assert.deepEqual(later.fills['tpl-shipped'].map(f => f.value), [`${marker}-O1`, 'November 20, 2026']);
    });
  } finally {
    await db.quotation.deleteMany({ where: { quoteNumber: { startsWith: marker } } });
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await db.user.deleteMany({ where: { id: { in: [sales.id, other.id] } } });
  }
});
