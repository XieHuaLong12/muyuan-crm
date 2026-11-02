import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { contactSpeedBucket, entryChannel, entryLabel, entryOf, inWorkHours, offsetLabel, waitText, workHoursOf } from '../lib/entry-time';
import { lossHint, lossReasonOf, missingQuestion, ruleDemand, supported } from '../lib/demand-profile';
import { MIN_GROUP, bestWindow, findings, gridView, heat, touchRates, touches } from '../lib/country-card';
import { easter, upcomingHolidays } from '../lib/holidays';
import { reviewOf, suggestionsFor } from '../lib/ai-plan';
import { customerList } from '../services/customer-list-service';
import { customerJourney, updateWorkHours } from '../services/entry-time-service';
import { demandProfile, lossSuggestion, scanDemand, updateDemand } from '../services/demand-profile-service';
import { countryCard } from '../services/country-card-service';
import { aiPlan, decideSuggestion } from '../services/ai-plan-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const at = (iso: string) => new Date(iso);
const TZ = 'Asia/Shanghai';

test('进线时间: exact clock time, date-only and estimated entries, work hours and both clocks', () => {
  assert.deepEqual(entryOf({ inquiryAt: at('2026-11-01T18:14:00Z'), createdAt: at('2026-11-02T00:00:00Z') }, TZ), { at: at('2026-11-01T18:14:00Z'), exact: true, estimated: false });
  assert.equal(entryOf({ inquiryAt: at('2026-10-31T16:00:00Z'), createdAt: at('2026-11-02T00:00:00Z') }, TZ).exact, false, 'midnight in company time is a date picked without a clock time');
  assert.deepEqual(entryOf({ inquiryAt: null, createdAt: at('2026-11-02T03:00:00Z') }, TZ), { at: at('2026-11-02T03:00:00Z'), exact: false, estimated: true });
  const hours = workHoursOf({ workStartHour: 8, workEndHour: 22 });
  assert.equal(inWorkHours(at('2026-11-01T18:14:00Z'), TZ, hours), false, '02:14 Beijing is outside 8–22');
  assert.equal(inWorkHours(at('2026-11-02T00:00:00Z'), TZ, hours), true, '08:00 Beijing starts the day');
  assert.equal(inWorkHours(at('2026-11-02T14:00:00Z'), TZ, hours), false, '22:00 Beijing has ended it');
  assert.deepEqual(workHoursOf({ workStartHour: 22, workEndHour: 8 }), { start: 8, end: 22 }, 'an impossible setting falls back');
  assert.equal(entryLabel(at('2026-11-01T18:14:00Z'), TZ), '11/2 周一 02:14');
  assert.equal(entryLabel(at('2026-11-01T18:14:00Z'), 'Europe/Paris'), '11/1 周日 19:14', 'Paris is UTC+1 in winter');
  assert.equal(entryLabel(at('2026-07-01T18:14:00Z'), 'Europe/Paris'), '7/1 周三 20:14', 'and UTC+2 in summer');
  assert.equal(offsetLabel(at('2026-11-01T18:14:00Z'), 'Europe/Paris'), 'UTC+1');
  assert.equal(offsetLabel(at('2026-11-01T18:14:00Z'), 'Africa/Abidjan'), 'UTC+0');
  assert.equal(offsetLabel(at('2026-11-01T18:14:00Z'), 'Asia/Kolkata'), 'UTC+5:30');
  assert.equal(entryChannel({ source: 'FACEBOOK', submissions: 1, formEvents: 0, ctwa: false }), 'FORM');
  assert.equal(entryChannel({ source: 'META_CLICK_TO_WHATSAPP', submissions: 0, formEvents: 0, ctwa: false }), 'CTWA');
  assert.equal(entryChannel({ source: 'WHATSAPP', submissions: 0, formEvents: 0, ctwa: false }), 'WHATSAPP');
  assert.equal(entryChannel({ source: 'EXHIBITION', submissions: 0, formEvents: 0, ctwa: false }), 'MANUAL');
  assert.equal(waitText(4), '4 分钟');
  assert.equal(waitText(372), '6 小时 12 分');
  assert.equal(waitText(60 * 53), '2 天 5 小时');
  assert.deepEqual([3, 5, 6, 30, 31, 120, 600, 601].map(contactSpeedBucket), [0, 0, 1, 1, 2, 2, 3, 4]);
});

test('需求画像: rules read the customer\'s words, AI values must quote them, questions and loss reasons', () => {
  const t = at('2026-11-01T09:31:00Z');
  const found = ruleDemand([
    { text: 'Bonjour, nous sommes grossiste à Lyon. Nous cherchons des matelas ressorts ensachés 160x200, environ 60 pièces pour commencer.', at: t },
    { text: 'Livraison au Havre avant mi-décembre possible ? Notre budget est autour de 85 € par pièce.', at: t },
    { text: 'Emballage roulé svp. Prix FOB svp', at: t },
  ]);
  const value = Object.fromEntries(found.map(f => [f.field, f.value]));
  assert.deepEqual(value, { buyer: '批发商', category: '独立袋装弹簧床垫', size: '160×200', quantity: '60 件', packaging: '卷包（压缩）', port: '勒阿弗尔（Le Havre）',
    deadline: '12 月中旬前', budget: '约 €85', incoterm: 'FOB' });
  assert.match(found.find(f => f.field === 'size')!.evidence, /160x200/);
  assert.equal(ruleDemand([{ text: 'Need 140x190 first', at: t }, { text: 'Sorry, 160 x 200 please', at: t }]).find(f => f.field === 'size')!.value, '160×200', 'the newest mention wins');
  assert.equal(ruleDemand([{ text: 'one 40HQ container', at: t }]).find(f => f.field === 'quantity')!.value, '40 尺柜');
  assert.equal(ruleDemand([{ text: 'I paid 85 euros for the taxi', at: t }]).find(f => f.field === 'budget'), undefined, 'money without a price context is not a budget');

  const texts = ['environ 60 pièces', 'matelas 160x200'];
  assert.equal(supported('quantity', '首批 60 件', 'environ 60 pièces', texts), true);
  assert.equal(supported('quantity', '首批 80 件', 'environ 60 pièces', texts), false, 'a number not in the quote is invented');
  assert.equal(supported('size', '160×200', '160x200', texts), true);
  assert.equal(supported('port', '勒阿弗尔', 'au Havre', texts), false, 'the quote must be the customer\'s words');
  assert.equal(supported('category', '床垫', 'matelas', texts), true);

  const ask = missingQuestion(new Set(['size', 'quantity', 'port'] as const), 'fr');
  assert.deepEqual(ask?.fields, ['incoterm', 'certification']);
  assert.match(ask!.text, /FOB ou CIF/);
  assert.equal(missingQuestion(new Set(['size', 'quantity', 'port', 'incoterm', 'certification', 'deadline', 'packaging'] as const), 'en'), null);

  assert.deepEqual(lossHint([{ text: "C'est trop cher, j'ai trouvé à 72 € ailleurs", at: t }], null), { reason: '价格太高', quote: "C'est trop cher, j'ai trouvé à 72 € ailleurs", at: t, competitorPrice: '€72' });
  assert.equal(lossHint([{ text: 'The shipping cost is too expensive for us', at: t }], null)?.reason, '运费太贵');
  assert.equal(lossHint([{ text: 'merci', at: t }], 20)?.reason, '不再回复');
  assert.equal(lossHint([{ text: 'merci', at: t }], 3), null);
  assert.equal(lossReasonOf('价格太高：别家 €72'), '价格太高');
  assert.equal(lossReasonOf('他说再想想'), '其他');
  assert.equal(lossReasonOf(''), '');
});

test('国家作战卡 rules: heat cells need 3 people, touches restart after a reply, findings need 20 per group', () => {
  const now = at('2026-11-02T00:00:00Z');
  const sends = [at('2026-10-20T08:00:00Z'), at('2026-10-20T08:20:00Z'), at('2026-10-20T08:40:00Z')];
  const grid = heat(sends, d => d, d => d.getUTCMinutes() > 10, 'UTC');
  const view = gridView(grid, () => false);
  assert.deepEqual(view[1].cells[8], { n: 3, hits: 2, rate: 66.7, off: false }, '2026-10-20 is a Tuesday');
  assert.equal(gridView(heat(sends.slice(0, 2), d => d, () => true, 'UTC'), () => false)[1].cells[8].rate, null, 'two people are too few');

  const msgs = [
    { direction: 'OUTBOUND', sentAt: at('2026-10-01T08:00:00Z') }, { direction: 'OUTBOUND', sentAt: at('2026-10-01T08:10:00Z') }, // touch 1 (two messages)
    { direction: 'OUTBOUND', sentAt: at('2026-10-03T08:00:00Z') }, // touch 2
    { direction: 'INBOUND', sentAt: at('2026-10-04T08:00:00Z') }, // answers touch 2
    { direction: 'OUTBOUND', sentAt: at('2026-10-05T08:00:00Z') }, // touch 1 again
    { direction: 'OUTBOUND', sentAt: at('2026-11-01T20:00:00Z') }, // window still open: left out
  ];
  const list = touches(msgs, now);
  assert.deepEqual(list.map(t => [t.n, t.replied]), [[1, false], [2, true], [1, false]]);
  assert.deepEqual(touchRates(list).slice(0, 2).map(r => [r.n, r.rate]), [[2, 0], [1, 100]]);

  const hours = Array.from({ length: 24 }, (_, h) => ({ n: h >= 16 && h < 19 ? 10 : 4, hits: h >= 16 && h < 19 ? 5 : 1 }));
  assert.deepEqual(bestWindow(hours, { start: 8, end: 22 }), { start: 16, end: 19, rate: 50, n: 30 });
  assert.equal(bestWindow(hours.map(() => ({ n: 1, hits: 1 })), { start: 8, end: 22 }), null, 'no window has 20 sends');

  const base = { country: '法国', workText: '8:00–22:00', send: { best: null, overall: null, total: 0 }, days: [], follow: [], speed: { fastN: 0, fastRate: null, slowN: 0, slowRate: null } };
  assert.equal(findings({ ...base, entry: { offN: MIN_GROUP - 1, offEffective: 2, inN: 40, inEffective: 20, offShare: 46 } }).length, 0, 'too few people outside working hours');
  const [entry] = findings({ ...base, entry: { offN: 30, offEffective: 9, inN: 40, inEffective: 20, offShare: 46 } });
  assert.equal(entry.tone, 'entry');
  assert.match(entry.title, /46% 的法国 A \/ B 线索在你下班后进来，这批有效率只有 30%/);
});

test('holidays: Easter-based dates are computed, the next ones are listed, Islamic dates are marked approximate', () => {
  assert.equal(easter(2027).toISOString().slice(0, 10), '2027-03-28');
  assert.equal(easter(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.deepEqual(upcomingHolidays('FR', '2026-11-02').map(h => [h.label, h.name]), [['11/11', '停战纪念日'], ['12/25', '圣诞节'], ['1/1', '元旦'], ['3/29', '复活节星期一']]);
  const ma = upcomingHolidays('MA', '2027-02-20', 6, 120);
  assert.ok(ma.some(h => h.name === '开斋节' && h.label.endsWith('约')));
  assert.deepEqual(upcomingHolidays('ZZ', '2026-11-02'), []);
});

test('AI 计划 rules: suggestions need enough people and a real gap; reviews compare the week before and after', () => {
  const facts = {
    country: '法国', localOffset: 'UTC+1', hours: { start: 8, end: 22 }, localWork: { start: '1:00', end: '15:00' },
    days: [{ label: '周二', n: 40, rate: 52 }, { label: '周六', n: 25, rate: 24 }, { label: '周日', n: 12, rate: 10 }],
    offEntry: { n: 30, effectiveRate: 31, inRate: 52 }, offShare: 46, inN: 40,
    ads: [{ name: '卷包视频', effective: 21, perEffective: 168 }, { name: '客厅图片', effective: 8, perEffective: 395 }],
  };
  const kinds = suggestionsFor(facts).map(s => s.kind);
  assert.deepEqual(kinds, ['WEEKDAY_BUDGET', 'DAYPART', 'CREATIVE']);
  assert.match(suggestionsFor(facts)[0].title, /周六预算降 30%，挪到周二/, 'Sunday has too few people to be compared');
  assert.deepEqual(suggestionsFor({ ...facts, days: [], offEntry: { n: 10, effectiveRate: 10, inRate: 60 }, ads: [] }), []);
  const review = reviewOf({ ab: 20, effective: 8, spend: 2000 }, { ab: 22, effective: 11, spend: 2000 });
  assert.equal(review.verdict, '有效果，继续保持');
  assert.equal(reviewOf({ ab: 2, effective: 1, spend: null }, { ab: 3, effective: 1, spend: null }).verdict, '样本太少，再看一周');
});

test('进线时间 in the customer centre: the work-hours filter, the journey and the setting', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role } as never;
  const tag = randomUUID().slice(0, 8);
  const make = (name: string, data: object) => db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, country: '法国', countryCode: 'FR', source: 'FACEBOOK', ...data } });
  try {
    const night = await make('Night', { inquiryAt: at('2026-11-01T18:14:00Z'), leadGrade: 'A' }); // 02:14 Beijing
    await make('Day', { inquiryAt: at('2026-11-01T09:05:00Z') }); // 17:05 Beijing
    await make('DateOnly', { inquiryAt: at('2026-10-29T16:00:00Z') }); // midnight: no clock time
    const names = async (entry: string) => (await customerList(actor, { group: 'all', q: tag, entry, pageSize: 50 })).rows.map(c => c.name.split(' ')[0]).sort();
    assert.deepEqual(await names('off'), ['Night']);
    assert.deepEqual(await names('in'), ['Day']);
    assert.deepEqual(await names(''), ['DateOnly', 'Day', 'Night']);

    await db.whatsAppMessage.create({ data: { customerId: night.id, direction: 'OUTBOUND', content: 'Bonjour Pierre', sentAt: at('2026-11-02T00:26:00Z'), readAt: at('2026-11-02T00:40:00Z'), status: 'READ', raw: '{}' } });
    await db.whatsAppMessage.create({ data: { customerId: night.id, direction: 'INBOUND', content: 'Oui, envoyez le catalogue', sentAt: at('2026-11-02T01:00:00Z'), status: 'RECEIVED', raw: '{}' } });
    const journey = await customerJourney(actor, night.id, at('2026-11-02T02:00:00Z'));
    assert.equal(journey.entry.company, '11/2 周一 02:14');
    assert.equal(journey.entry.local?.label, '11/1 周日 19:14');
    assert.equal(journey.entry.offHours, true);
    assert.equal(journey.entry.channel, 'MANUAL');
    const first = journey.steps.find(s => s.title === '第一条消息');
    assert.equal(first?.gap, '等了 6 小时 12 分');
    assert.equal(first?.tone, 'slow');
    assert.match(journey.steps.find(s => s.title === '客户回复')!.detail, /成为有效客户/);

    const before = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { workStartHour: true, workEndHour: true } });
    try {
      await assert.rejects(updateWorkHours(actor, { start: 20, end: 9 }));
      assert.deepEqual((await updateWorkHours(actor, { start: 9, end: 21 })).hours, { start: 9, end: 21 });
      await assert.rejects(updateWorkHours({ ...(actor as object), role: 'SALES' } as never, { start: 9, end: 21 }), /管理员/);
    } finally { await db.setting.update({ where: { id: 'system' }, data: before }); }
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
  }
});

test('需求画像 service: scan, confirm, a person\'s value is kept, quotation readiness and the loss pre-pick', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role } as never;
  const tag = randomUUID().slice(0, 8);
  const c = await db.customer.create({ data: { name: `Lucas ${tag}`, ownerId: admin.id, country: '法国', countryCode: 'FR', language: 'fr', leadGrade: 'A' } });
  const key = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY; // rules only: no network in tests
  try {
    const say = (text: string, iso: string) => db.whatsAppMessage.create({ data: { customerId: c.id, direction: 'INBOUND', content: text, sentAt: at(iso), status: 'RECEIVED', raw: '{}' } });
    await say('Nous cherchons des matelas 160x200, environ 60 pièces.', '2026-11-01T09:31:00Z');
    await say('Livraison au Havre ?', '2026-11-01T10:02:00Z');
    let profile = await scanDemand(actor, c.id);
    assert.equal(profile.total, 4);
    assert.equal(profile.confirmed, 0);
    assert.equal(profile.quote.ready, false);
    assert.deepEqual(profile.question?.fields, ['incoterm', 'certification']);

    profile = await updateDemand(actor, { action: 'set', customerId: c.id, field: 'size', value: '160×200×25' });
    profile = await updateDemand(actor, { action: 'confirmAll', customerId: c.id });
    assert.equal(profile.confirmed, 4);
    assert.equal(profile.quote.ready, true);
    await say('Finalement 140x190', '2026-11-01T11:00:00Z');
    await db.customer.update({ where: { id: c.id }, data: { lastInboundAt: new Date(Date.now() + 60_000) } }); // written after the last scan
    assert.equal((await demandProfile(actor, c.id)).stale, true);
    profile = await scanDemand(actor, c.id);
    assert.equal(profile.fields.find(f => f.field === 'size')?.value, '160×200×25', 'a confirmed value is never replaced by a later scan');
    profile = await updateDemand(actor, { action: 'set', customerId: c.id, field: 'size', value: '' });
    assert.equal(profile.fields.find(f => f.field === 'size')?.status, 'MISSING');
    await assert.rejects(updateDemand(actor, { action: 'confirm', customerId: c.id, field: 'nope' }), /没有这一项/);

    await say("C'est trop cher, j'ai trouvé à 72 € ailleurs", '2026-11-01T12:00:00Z');
    const loss = await lossSuggestion(actor, c.id);
    assert.equal(loss.hint?.reason, '价格太高');
    assert.equal(loss.hint?.competitorPrice, '€72');
    assert.equal(loss.ourPrice, '');
  } finally {
    if (key !== undefined) process.env.DEEPSEEK_API_KEY = key;
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
  }
});

test('国家作战卡 and AI 计划 on real records: counts, speed, touches, needs, and adopting a suggestion', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role } as never;
  const tag = randomUUID().slice(0, 8), country = `测试国${tag}`;
  const now = at('2026-11-02T06:00:00Z');
  const make = (name: string, data: object) => db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, country, source: 'FACEBOOK', ...data } });
  const suggestionKey = `WEEKDAY_BUDGET:${country}:test`;
  try {
    const fast = await make('Fast', { leadGrade: 'A', isQualified: true, stage: 'REPLIED', inquiryAt: at('2026-10-20T02:00:00Z') });
    const slow = await make('Slow', { leadGrade: 'B', inquiryAt: at('2026-10-20T15:00:00Z') });
    await make('Other', { leadGrade: 'C', inquiryAt: at('2026-10-21T03:00:00Z') });
    const msg = (customerId: string, direction: string, iso: string) => db.whatsAppMessage.create({ data: { customerId, direction, content: direction, sentAt: at(iso), status: direction === 'OUTBOUND' ? 'SENT' : 'RECEIVED', raw: '{}' } });
    await msg(fast.id, 'OUTBOUND', '2026-10-20T02:03:00Z');
    await msg(fast.id, 'INBOUND', '2026-10-20T03:00:00Z');
    await msg(slow.id, 'OUTBOUND', '2026-10-21T01:30:00Z'); // 10.5 hours after entry
    await msg(slow.id, 'OUTBOUND', '2026-10-24T01:00:00Z');
    await db.customerDemandField.create({ data: { customerId: fast.id, field: 'size', value: '160×200', source: 'HUMAN', status: 'CONFIRMED' } });

    const card = await countryCard(actor, { country, weeks: '4' }, now);
    assert.equal(card.empty, false);
    if (card.empty) return;
    assert.deepEqual([card.kpis.leads, card.kpis.ab, card.kpis.effective], [3, 2, 1]);
    assert.equal(card.kpis.offShare, 33.3, 'the 23:00 Beijing entry is one of three');
    assert.deepEqual(card.speed.map(s => s.n), [1, 0, 0, 0, 1]);
    assert.equal(card.speed[0].rate, 100);
    assert.deepEqual(card.follow.slice(0, 2).map(f => [f.n, f.replied]), [[2, 1], [1, 0]]);
    assert.deepEqual(card.needs.map(n => [n.label, n.parts[0].value]), [['尺寸', '160×200']]);
    assert.equal(card.findings.length, 0, 'three customers are far too few for a finding');
    assert.equal(card.ads.synced, false);

    const plan = await aiPlan(actor, now);
    assert.equal(plan.blocks[0].key, 'night');
    assert.ok(plan.blocks.some(b => b.key === 'wrap'));

    const created = await db.planSuggestion.create({ data: { key: suggestionKey, kind: 'WEEKDAY_BUDGET', country, title: 't', body: 'b', basis: 'x', metric: {} } });
    await decideSuggestion(actor, { id: created.id, status: 'ADOPTED' }, now);
    const adopted = await db.planSuggestion.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(adopted.status, 'ADOPTED');
    assert.equal(adopted.reviewAt?.toISOString(), '2026-11-09T06:00:00.000Z');
    await decideSuggestion(actor, { id: created.id, status: 'PENDING' }, now);
    assert.equal((await db.planSuggestion.findUniqueOrThrow({ where: { id: created.id } })).reviewAt, null);
    await assert.rejects(decideSuggestion({ ...(actor as object), role: 'SALES' } as never, { id: created.id, status: 'ADOPTED' }), /管理员/);
  } finally {
    await db.planSuggestion.deleteMany({ where: { key: suggestionKey } });
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
  }
});
