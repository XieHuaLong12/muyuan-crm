import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import webpush from 'web-push';
import { db } from '../lib/db';
import type { Actor } from '../lib/auth';
import { formAnswers, importsFromChina, ringFor, ruleGrade, type GradeInput } from '../lib/lead-grade';
import { POST as webhook } from '../app/api/leads/webhook/route';
import { gradeLead } from '../services/lead-grade-service';
import { deliverLeadAlerts } from '../services/lead-alert-service';
import { savePushSubscription, removePushSubscription } from '../services/push-service';
import { assignCustomers } from '../services/lead-assignment-service';
import { notificationFeed } from '../services/notification-service';
import { createUserAccount } from '../services/sales-account-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actor = (u: { id: string; name: string; email: string; role: string }): Actor => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const base: GradeInput = { answers: [], purchaseType: 'OTHER', quantity: null, productInterest: '', country: '', hasPhone: true, hasEmail: false, testLead: false };
const answer = (question: string, value: string) => ({ question, answer: value });

test('form answers decide the fallback grade', () => {
  const imports = [answer('do you currently import furniture from china?', 'yes,_regularly')];
  assert.equal(ruleGrade({ ...base, purchaseType: 'WHOLESALE', quantity: 50, answers: imports }).grade, 'A');
  assert.equal(ruleGrade({ ...base, purchaseType: 'WHOLESALE', quantity: 15, answers: imports }).grade, 'B', 'below the offline minimum order');
  assert.equal(ruleGrade({ ...base, purchaseType: 'IMPORTER', quantity: 12 }).grade, 'B', 'a business buyer without import experience');
  assert.equal(ruleGrade({ ...base, quantity: 30 }).grade, 'C', 'no identity is C, whatever the quantity');
  assert.equal(ruleGrade({ ...base, quantity: 3 }).grade, 'C');
  assert.equal(ruleGrade({ ...base, hasPhone: false }).grade, 'D', 'nobody can be contacted');
  assert.equal(ruleGrade({ ...base, testLead: true, purchaseType: 'WHOLESALE', quantity: 99 }).grade, 'D');
  assert.match(ruleGrade({ ...base, purchaseType: 'WHOLESALE', quantity: 50, answers: imports, country: '法国' }).reason, /批发商；采购 50 件；已从中国进口；法国/);
  for (const [value, expected] of [['oui', true], ['Sí, ya importamos', true], ['not_yet', false], ['Non', false], ['نعم', true], ['maybe later', null]] as const)
    assert.equal(importsFromChina([answer('Importez-vous des meubles de Chine ?', value)]), expected, value);
  assert.deepEqual([ringFor('A'), ringFor('B'), ringFor('C'), ringFor('D'), ringFor('')], ['loop', 'loop', 'once', 'none', 'loop'], 'an ungraded lead rings like a good one');
  // Contact details never reach the grading input.
  const graph = JSON.stringify({ field_data: [{ name: 'full_name', values: ['Jean'] }, { name: 'email', values: ['j@x.test'] }, { name: 'phone_number', values: ['+33612345678'] },
    { name: 'company_name', values: ['Maison Jean'] }, { name: 'estimated_order_quantity', values: ['50'] }] });
  assert.deepEqual(formAnswers(graph), [answer('company name', 'Maison Jean'), answer('estimated order quantity', '50')]);
  assert.deepEqual(formAnswers(JSON.stringify({ '姓名': 'Li', '采购数量': '40' })), [answer('采购数量', '40')], 'smart-import rows too');
});

const appSecret = 'alerts-test-app-secret', token = 'alerts-test-page-token';
type GraphRow = { id: string; created_time: string; form_id: string; field_data: { name: string; values: string[] }[] };

test('a new form is graded by AI, rings administrators\' phones once, and the assigned salesperson next', async t => {
  const env = { ...process.env };
  const original = globalThis.fetch;
  const admin = actor(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const tag = randomUUID().slice(0, 8), formId = `form-alert-${tag}`;
  const leads = new Map<string, GraphRow>(), leadIds: string[] = [], users: string[] = [], endpoints: string[] = [];
  const deepSeekRequests: string[] = [];
  // The fake AI grades by what the form says, like the real one would.
  let aiDown = false;
  const aiAnswer = (body: string) => body.includes('wholesaler') ? { grade: 'A', reasons: ['批发商', '每款 50 件', '已从中国进口'] }
    : body.includes('importer') ? { grade: 'B', reasons: ['进口商', '未填写数量'] } : { grade: 'D', reasons: ['与家具无关'] };
  const lead = (fields: Record<string, string>, minutesAgo = 1) => {
    const id = `alert-${tag}-${leadIds.length}`;
    leads.set(id, { id, form_id: formId, created_time: new Date(Date.now() - minutesAgo * 60_000).toISOString().replace('Z', '+0000'),
      field_data: Object.entries({ full_name: `Alert ${id}`, email: `${id}@example.test`, ...fields }).map(([name, value]) => ({ name, values: [value] })) });
    leadIds.push(id);
    return id;
  };
  const receive = async (id: string) => {
    const raw = JSON.stringify({ object: 'page', entry: [{ id: 'page-alert', changes: [{ field: 'leadgen', value: { leadgen_id: id, form_id: formId, page_id: 'page-alert' } }] }] });
    const response = await webhook(new NextRequest('https://example.test/api/leads/webhook', { method: 'POST', body: raw,
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}` } }));
    assert.equal(response.status, 200);
    return (await db.metaLeadEvent.findUniqueOrThrow({ where: { leadgenId: id } })).customerId!;
  };
  const pushed: { endpoint: string; payload: { title: string; body: string; tag: string; urgent: boolean; href: string } }[] = [];
  const gone = new Set<string>();
  t.mock.method(webpush, 'sendNotification', async (subscription: { endpoint: string }, payload: string) => {
    if (gone.has(subscription.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    pushed.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    return { statusCode: 201, body: '', headers: {} };
  });
  process.env.META_APP_SECRET = appSecret;
  process.env.META_PAGE_ACCESS_TOKEN = token;
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
  delete process.env.META_ADS_ACCESS_TOKEN;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.deepseek.com') {
      deepSeekRequests.push(String(init?.body));
      if (aiDown) return Response.json({ error: { message: 'overloaded' } }, { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify(aiAnswer(String(init?.body))) } }] });
    }
    assert.equal(url.hostname, 'graph.facebook.com');
    const row = leads.get(decodeURIComponent(url.pathname.split('/').filter(Boolean)[1]));
    return row ? Response.json(row) : Response.json({ error: { code: 100, message: 'Unknown' } }, { status: 400 });
  }) as typeof fetch;
  const mode = (await db.setting.findUniqueOrThrow({ where: { id: 'system' } })).leadAssignMode;
  await db.setting.update({ where: { id: 'system' }, data: { leadAssignMode: 'POOL' } });
  try {
    const sales = actor(await createUserAccount({ name: `Alert sales ${tag}`, email: `alert-${tag}@example.test`, password: 'alert-password' }, admin));
    users.push(sales.id);
    const device = (who: string) => `https://fcm.googleapis.com/fcm/send/${who}-${tag}`;
    endpoints.push(device('admin'), device('sales'));
    await savePushSubscription(admin, { endpoint: device('admin'), keys: { p256dh: 'BKey', auth: 'auth' } }, 'Android');
    await savePushSubscription(sales, { endpoint: device('sales'), keys: { p256dh: 'BKey', auth: 'auth' } }, 'iPhone');
    // The server only ever posts to real push services.
    await assert.rejects(savePushSubscription(admin, { endpoint: 'https://evil.example.com/hook', keys: { p256dh: 'a', auth: 'b' } }));
    await assert.rejects(savePushSubscription(admin, { endpoint: 'http://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'a', auth: 'b' } }));

    const good = await receive(lead({ phone_number: '+33612345678', 'what best describes your business?': 'wholesaler', 'do you currently import furniture from china?': 'yes,_regularly', 'estimated order quantity per model': '50' }));
    const junk = await receive(lead({ 'what best describes your business?': 'other' }));
    const old = await receive(lead({ 'what best describes your business?': 'importer' }, 3 * 24 * 60));
    assert.equal(await db.leadAlert.count({ where: { customerId: { in: [good, junk, old] }, kind: 'NEW', sentAt: null } }), 3, 'queued with the lead, sent after the response');

    // Before delivery the feed already announces the pooled lead (ungraded leads ring like good ones).
    await deliverLeadAlerts();
    const graded = await db.customer.findUniqueOrThrow({ where: { id: good } });
    assert.deepEqual([graded.leadGrade, graded.leadGradeSource, graded.leadGradeReason], ['A', 'AI', '批发商；每款 50 件；已从中国进口']);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: junk } })).leadGrade, 'D');
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: old } })).leadGrade, 'B', 'old leads are graded but not announced');
    for (const body of deepSeekRequests) assert.ok(!/example\.test|Alert alert-|33612345678/.test(body), 'names, emails and phone numbers are not sent to the AI');

    const mine = pushed.filter(p => [good, junk, old].some(id => p.payload.tag === `lead:${id}`));
    assert.deepEqual(mine.map(p => p.endpoint), [device('admin')], 'one push to the administrator, none for D or old leads');
    assert.equal(mine[0].payload.title, 'A 级新线索 · 待分配');
    assert.equal(mine[0].payload.urgent, true);
    assert.match(mine[0].payload.body, /法国 · 批发商；每款 50 件；已从中国进口/);
    assert.equal((await deliverLeadAlerts()).alerts, 0, 'each alert is sent once');

    const feed = await notificationFeed(admin);
    const pool = feed.items.find(item => item.id === `pool:${good}`)!;
    assert.deepEqual([pool.title, pool.ring, pool.tag], ['A 级新线索待分配', 'loop', `lead:${good}`]);
    assert.equal(feed.items.find(item => item.id === `pool:${junk}`)?.ring, 'none', 'D leads stay quiet');

    // Assigning the lead rings the salesperson's phone with the deadline.
    pushed.length = 0;
    await assignCustomers({ ids: [good], ownerId: sales.id }, admin);
    await deliverLeadAlerts();
    const assigned = pushed.filter(p => p.payload.tag === `assign:${good}`);
    assert.deepEqual(assigned.map(p => p.endpoint), [device('sales')]);
    const { adLeadFirstContactMinutes } = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
    assert.equal(assigned[0].payload.title, '新分配客户 · A 级');
    assert.match(assigned[0].payload.body, new RegExp(`请在 ${adLeadFirstContactMinutes} 分钟内联系`));
    const salesFeed = await notificationFeed(sales);
    assert.equal(salesFeed.items.find(item => item.kind === 'ASSIGNED' && item.href === `/customers/${good}`)?.ring, 'loop');

    // A phone that uninstalled the app is forgotten the first time the push service says so.
    gone.add(device('sales'));
    await assignCustomers({ ids: [old], ownerId: sales.id }, admin);
    await deliverLeadAlerts();
    assert.equal(await db.pushSubscription.count({ where: { endpoint: device('sales') } }), 0);

    // Without an answer from the AI the rules decide.
    aiDown = true;
    await db.customer.update({ where: { id: good }, data: { leadGrade: '' } });
    const fallback = await gradeLead(good);
    assert.deepEqual([fallback?.grade, fallback?.source], ['A', 'RULE']);
    const plain = await db.customer.create({ data: { name: `Alert plain ${tag}`, ownerId: admin.id, whatsapp: '+8613800138000' } });
    assert.equal(await gradeLead(plain.id), null, 'WhatsApp customers without a form are judged from the conversation, not graded');

    await removePushSubscription(admin, { endpoint: device('admin') });
    assert.equal(await db.pushSubscription.count({ where: { endpoint: device('admin') } }), 0);
  } finally {
    globalThis.fetch = original;
    for (const key of ['META_APP_SECRET', 'META_PAGE_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN', 'DEEPSEEK_API_KEY']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    await db.setting.update({ where: { id: 'system' }, data: { leadAssignMode: mode } });
    await db.pushSubscription.deleteMany({ where: { endpoint: { in: endpoints } } });
    const events = await db.metaLeadEvent.findMany({ where: { leadgenId: { in: leadIds } }, select: { customerId: true } });
    const customerIds = events.map(e => e.customerId).filter((id): id is string => !!id);
    await db.metaLeadEvent.deleteMany({ where: { leadgenId: { in: leadIds } } });
    await db.task.deleteMany({ where: { customerId: { in: customerIds } } });
    await db.customerAssignment.deleteMany({ where: { customerId: { in: customerIds } } });
    await deleteTestCustomers({ where: { OR: [{ id: { in: customerIds } }, { name: `Alert plain ${tag}` }] } });
    await db.accountAudit.deleteMany({ where: { subjectId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
