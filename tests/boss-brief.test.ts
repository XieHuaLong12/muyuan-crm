import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { db } from '../lib/db';
import type { Actor } from '../lib/auth';
import { localDate } from '../lib/time';
import { briefFacts, briefLinks, checkAnomalies, deliverDailyBrief, rulesText, todayBrief } from '../services/boss-brief-service';
import { savePushSubscription } from '../services/push-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actor = (u: { id: string; name: string; email: string; role: string }): Actor => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// A day far from every other test's data, so the brief's day contains only what this test writes.
const DAY = '2031-03-15', YESTERDAY = '2031-03-14';

test('the morning brief counts yesterday and today\'s risks, goes to the boss\'s phone once, and alerts on overdue leads and a lead drop', async t => {
  const env = { ...process.env };
  const original = globalThis.fetch;
  const tag = randomUUID().slice(0, 8);
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const at = (key: string, time: string) => localDate(`${key}T${time}`, timezone);
  const now = at(DAY, '09:30');
  const keys = [`boss-brief:${DAY}`, `boss-brief:${DAY}:pushed`, `anomaly:lead-drop:${DAY}`];
  const admin = actor(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const seller = await db.user.create({ data: { name: `Seller ${tag}`, email: `seller-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const device = (who: string) => `https://fcm.googleapis.com/fcm/send/brief-${who}-${tag}`;
  const pushed: { endpoint: string; payload: { title: string; body: string; tag: string; urgent: boolean; href: string } }[] = [];
  t.mock.method(webpush, 'sendNotification', async (subscription: { endpoint: string }, payload: string) => {
    pushed.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    return { statusCode: 201, body: '', headers: {} };
  });
  const mine = (who: string) => pushed.filter(p => p.endpoint === device(who)).map(p => p.payload);
  const aiRequests: string[] = [];
  let aiDown = false;
  const ai = { headline: '昨天 5 条新线索，A/B 2 条，成交 1 单', highlights: ['广告效果好'], risks: ['1 位 B 级线索首联超时'], actions: ['催 Seller 联系'] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new URL(String(input)).hostname, 'api.deepseek.com');
    aiRequests.push(String(init?.body));
    if (aiDown) return Response.json({ error: { message: 'overloaded' } }, { status: 503 });
    return Response.json({ choices: [{ message: { content: JSON.stringify(ai) } }] });
  }) as typeof fetch;
  await db.dailyAdInsight.deleteMany({ where: { reportKey: { in: keys } } });
  try {
    await savePushSubscription(admin, { endpoint: device('admin'), keys: { p256dh: 'BKey', auth: 'auth' } }, 'Android');
    await savePushSubscription(actor(seller), { endpoint: device('seller'), keys: { p256dh: 'BKey', auth: 'auth' } }, 'iPhone');
    const before = await briefFacts(now);

    const lead = async (name: string, data: object, ad?: string) => {
      const customer = await db.customer.create({ data: { name: `${name} ${tag}`, ownerId: seller.id, source: 'FACEBOOK', ...data } });
      if (ad) await db.customerLeadAttribution.create({ data: { leadKey: `brief-${customer.id}`, customerId: customer.id, adName: ad, source: 'TEST' } });
      return customer;
    };
    // Contacted ten minutes before the deadline: on time, 20 minutes.
    const good = await lead('Lead-good', { stage: 'CONTACTED', leadGrade: 'A', inquiryAt: at(YESTERDAY, '10:00'), assignedAt: at(YESTERDAY, '10:00'),
      firstContactDueAt: at(YESTERDAY, '10:30'), firstContactAt: at(YESTERDAY, '10:20'), contactedAt: at(YESTERDAY, '10:20') }, `Ad good ${tag}`);
    // Nobody has contacted this B lead: late, and still overdue this morning.
    const late = await lead('Lead-late', { stage: 'NEW', leadGrade: 'B', inquiryAt: at(YESTERDAY, '11:00'), assignedAt: at(YESTERDAY, '11:00'),
      firstContactDueAt: at(YESTERDAY, '11:30') }, `Ad good ${tag}`);
    for (let i = 0; i < 3; i++) await lead(`Lead-weak${i}`, { leadGrade: 'C', inquiryAt: at(YESTERDAY, '12:00'), ownerId: admin.id }, `Ad weak ${tag}`);
    await db.deal.create({ data: { customerId: good.id, salespersonId: seller.id, dealAmount: 1200, productCost: 0, grossProfit: 0, grossMargin: 0, currency: 'USD', dealDate: at(YESTERDAY, '15:00') } });
    await db.quotation.create({ data: { customerId: good.id, quoteNumber: `Q-BRIEF-${tag}`, product: 'Sofa', quantity: 20, unitPrice: 60, currency: 'USD', incoterm: 'FOB', notes: '', status: 'SENT', sentAt: at(YESTERDAY, '14:00'), createdBy: seller.id } });
    const lost = await lead('Lead-lost', { stage: 'LOST', invalidReason: `价格太高 ${tag}`, inquiryAt: at('2031-02-01', '10:00') });
    await db.stageHistory.create({ data: { customerId: lost.id, fromStage: 'QUOTED', toStage: 'LOST', changedAt: at('2031-03-05', '10:00'), changedBy: seller.id, note: '价格太高' } });

    const facts = await briefFacts(now);
    const grade = (f: typeof facts, g: string) => f.leads.grades.find(row => row.grade === g)?.count ?? 0;
    assert.equal(facts.yesterday, YESTERDAY);
    assert.equal(facts.leads.total - before.leads.total, 5);
    assert.deepEqual(['A', 'B', 'C'].map(g => grade(facts, g) - grade(before, g)), [1, 1, 3]);
    assert.deepEqual(facts.ads.best.find(a => a.ad === `Ad good ${tag}`), { ad: `Ad good ${tag}`, leads: 2, good: 2 });
    assert.deepEqual(facts.ads.weak.find(a => a.ad === `Ad weak ${tag}`), { ad: `Ad weak ${tag}`, leads: 3 }, 'three leads and not one A/B');
    assert.deepEqual(facts.firstContact.find(p => p.name === `Seller ${tag}`), { name: `Seller ${tag}`, assigned: 2, onTime: 1, late: 1, medianMinutes: 20 });
    assert.equal(facts.results.deals - before.results.deals, 1);
    assert.equal(facts.results.quotes - before.results.quotes, 1);
    const usd = (f: typeof facts) => Number(f.results.amount.find(m => m.currency === 'USD')?.amount ?? 0);
    assert.equal(usd(facts) - usd(before), 1200);
    assert.equal(facts.risks.goodLeadsOverdue - before.risks.goodLeadsOverdue, 1);
    assert.deepEqual(facts.losses.find(l => l.reason === `价格太高 ${tag}`), { reason: `价格太高 ${tag}`, count: 1 });
    assert.deepEqual([facts.month.day, facts.month.days], [15, 31]);

    const rules = rulesText(facts);
    assert.match(rules.headline, /^昨天新线索 \d+ 条（A\/B \d+ 条）/);
    assert.ok(rules.risks.some(r => r.includes('A/B 线索已超过首联时限')));
    assert.ok(briefLinks(facts).some(l => l.href === '/sales?queue=new' && l.tone === 'risk'));

    // Before 08:00 nothing is made or sent; the cockpit shows a rules version computed on the spot.
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    assert.deepEqual(await deliverDailyBrief(at(DAY, '07:59')), { brief: false, pushed: 0 });
    const preview = await todayBrief(at(DAY, '07:59'));
    assert.deepEqual([preview.stored, preview.source], [false, 'RULES']);
    assert.equal(aiRequests.length, 0);

    // From 08:00: the AI words it from the numbers, without any customer's name, and the boss's phone gets it once.
    await deliverDailyBrief(now);
    assert.equal(aiRequests.length, 1);
    assert.ok(!/Lead-|example\.test/.test(aiRequests[0]), 'no customer names or emails go to the AI');
    assert.ok(aiRequests[0].includes(`Ad good ${tag}`));
    assert.deepEqual(mine('admin').filter(p => p.tag === `brief:${DAY}`).map(p => [p.title, p.body, p.urgent, p.href]),
      [['今日简报 · 3月15日', `${ai.headline}\n${ai.risks[0]}`, false, '/command-center#brief']]);
    assert.equal(mine('seller').filter(p => p.tag.startsWith('brief:')).length, 0, 'the brief is for administrators');
    await deliverDailyBrief(at(DAY, '10:30'));
    assert.equal(mine('admin').filter(p => p.tag === `brief:${DAY}`).length, 1, 'once a day, however often the jobs run');
    assert.equal(aiRequests.length, 1, 'made once');
    const stored = await todayBrief(at(DAY, '18:00'));
    assert.deepEqual([stored.stored, stored.source, stored.text.headline], [true, 'AI', ai.headline]);
    assert.equal(stored.facts.leads.total, facts.leads.total, 'the morning numbers stay as they were sent');

    // When the AI fails, the rules write the brief.
    aiDown = true;
    await db.dailyAdInsight.deleteMany({ where: { reportKey: `boss-brief:${DAY}` } });
    await deliverDailyBrief(now);
    const fallback = await todayBrief(now);
    assert.deepEqual([fallback.stored, fallback.source, fallback.text.headline], [true, 'RULES', rulesText(fallback.facts).headline]);

    // The overdue B lead rings its owner and the administrators once.
    const first = await checkAnomalies(now);
    assert.ok(first.overdue >= 1);
    assert.deepEqual(mine('seller').filter(p => p.tag === `overdue:${late.id}`).map(p => [p.title, p.body, p.urgent]),
      [['B 级线索首联已超时', `Lead-late ${tag} · 超时 22 小时，请马上联系`, true]]);
    assert.match(mine('admin').find(p => p.tag === `overdue-batch:${DAY}`)?.body ?? '', new RegExp(`Lead-late ${tag}（Seller ${tag}，超时 22 小时）`));
    const count = pushed.length;
    assert.equal((await checkAnomalies(at(DAY, '09:45'))).overdue, 0, 'each lead is reported once');
    assert.equal(pushed.length, count);
    // Several at once (the first run after release) reach the salesperson as one push.
    for (let i = 0; i < 4; i++) await lead(`Lead-burst${i}`, { stage: 'NEW', leadGrade: 'A', assignedAt: at(DAY, '08:30'), firstContactDueAt: at(DAY, '09:00') });
    assert.equal((await checkAnomalies(at(DAY, '09:50'))).overdue, 4);
    assert.deepEqual(mine('seller').filter(p => p.tag.startsWith('overdue')).map(p => [p.tag, p.title]),
      [[`overdue:${late.id}`, 'B 级线索首联已超时'], [`overdue-mine:${DAY}`, '4 位 A/B 线索首联已超时']]);

    // From 14:00, a day with far fewer leads than the same hours of the last week alerts the administrators once.
    for (let day = 1; day <= 7; day++)
      for (let i = 0; i < 3; i++) await lead(`Lead-past${day}-${i}`, { inquiryAt: at(new Date(Date.parse(`${DAY}T12:00:00Z`) - day * 86400_000).toISOString().slice(0, 10), '09:00') });
    assert.equal((await checkAnomalies(at(DAY, '13:30'))).leadDrop, false, 'not judged before 14:00');
    assert.equal((await checkAnomalies(at(DAY, '15:00'))).leadDrop, true);
    const drop = mine('admin').filter(p => p.tag === `lead-drop:${DAY}`);
    assert.equal(drop.length, 1);
    assert.match(drop[0].body, /^截至 15:00 收到 0 条，过去 7 天同一时段平均 3\.7 条/);
    assert.equal((await checkAnomalies(at(DAY, '16:00'))).leadDrop, false, 'once a day');
  } finally {
    globalThis.fetch = original;
    if (env.DEEPSEEK_API_KEY === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
    await db.dailyAdInsight.deleteMany({ where: { reportKey: { in: keys } } });
    await db.pushSubscription.deleteMany({ where: { endpoint: { in: [device('admin'), device('seller')] } } });
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.user.delete({ where: { id: seller.id } });
    await db.$disconnect();
  }
});
