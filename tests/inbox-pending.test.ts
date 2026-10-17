import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { inboxConversations } from '../services/inbox-service';
import { firstNameOf, firstTouchSuggestion, listTemplates, productLineOf, sendTemplateMessage, type ApprovedTemplate } from '../services/whatsapp-template-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const business = '+19195550404';
const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const template = (id: string, name: string, language = 'en', variables = 3): ApprovedTemplate =>
  ({ id, name, language, category: 'UTILITY', body: 'Hi {{1}}, it is {{2}} about {{3}}.', variables });

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

  const lead = { name: 'KHALID AL-HARBI', source: 'FACEBOOK', sourceDetail: 'Sofa_SA_Oct', productInterest: '', productModel: '', language: '', owner: { name: 'Jason' } };
  const approved = [template('t-first', 'lvanju_first_fb_en'), template('t-hi', 'lvanju_hi_fb_en'), template('t-ig', 'lvanju_hi_ig_en'), template('t-other', 'follow_up_general')];
  assert.deepEqual(firstTouchSuggestion(lead, approved), { templateId: 't-hi', params: ['Khalid', 'Jason', 'compressed sofas'], labels: ['客户名', '负责销售', '产品线'], productVariable: 3 });
  assert.equal(firstTouchSuggestion(lead, approved.filter(t => t.id !== 't-hi'))?.templateId, 't-first', 'the first version until the v2 greeting is approved');
  assert.equal(firstTouchSuggestion({ ...lead, source: 'INSTAGRAM' }, approved)?.templateId, 't-ig');
  assert.equal(firstTouchSuggestion({ ...lead, source: 'WEBSITE' }, approved), null, 'only ad leads from Facebook and Instagram get a greeting');
  assert.equal(firstTouchSuggestion({ ...lead, source: 'INSTAGRAM' }, [template('t-first', 'lvanju_first_fb_en')]), null);

  // A French lead gets the French greeting once it exists; the English product names are not put into it.
  const french = firstTouchSuggestion({ ...lead, language: 'fr' }, [...approved, template('t-hi-fr', 'lvanju_hi_fb_fr', 'fr')]);
  assert.equal(french?.templateId, 't-hi-fr'); assert.deepEqual(french?.params, ['Khalid', 'Jason', '']);
  // A greeting with another number of variables is still suggested, but left for the salesperson to fill.
  assert.deepEqual(firstTouchSuggestion(lead, [template('t-two', 'lvanju_hi_fb_en', 'en', 2)]), { templateId: 't-two', params: ['', ''], labels: [], productVariable: null });
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
          { id: 'tpl-hi', elementName: 'lvanju_hi_fb_en', languageCode: 'en', category: 'UTILITY', status: 'APPROVED', templateType: 'TEXT', data: 'Hi {{1}}, {{2}} here, the factory behind the ad for {{3}}.' }] });
        if (url === 'https://api.gupshup.io/wa/api/v1/template/msg') return Response.json({ status: 'submitted', messageId: `gs-${marker}` });
        return new Response('unexpected', { status: 500 });
      });
      const list = await listTemplates(me, { customerId: soon.id, refresh: '1' });
      assert.deepEqual(list.suggestion, { templateId: 'tpl-hi', params: [marker, `${marker} Seller`, 'compressed sofas'], labels: ['客户名', '负责销售', '产品线'], productVariable: 3 });
      const sent = await sendTemplateMessage({ customerId: soon.id, templateId: 'tpl-hi', params: list.suggestion!.params, requestId: randomUUID() }, me);
      assert.equal(sent.message.content, `Hi ${marker}, ${marker} Seller here, the factory behind the ad for compressed sofas.`);
      // The greeting is the first contact: the customer leaves 待首联 and gets no greeting suggested again.
      assert.deepEqual(names((await inboxConversations(me, { filter: 'pending', q: marker })).pending), ['Late', 'Later']);
      assert.equal((await listTemplates(me, { customerId: soon.id })).suggestion, null);
    });
  } finally {
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await db.user.deleteMany({ where: { id: { in: [sales.id, other.id] } } });
  }
});
