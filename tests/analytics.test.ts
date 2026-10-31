import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { periodPair, trendBuckets } from '../lib/business-cockpit';
import {
  busiestHours, customerStatus, firstContact, funnelCounts, funnelDepth, gradeChange, median, responseTurns, speedBucket, weakestStep, weekendDifference,
} from '../lib/analytics';
import { countryTimezone } from '../lib/country-timezone';
import { customerAnalytics } from '../services/customer-analytics-service';
import { messageAnalytics } from '../services/message-analytics-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const at = (iso: string) => new Date(iso);
const facts = (overrides: Partial<Parameters<typeof funnelDepth>[0]> = {}) => ({
  stage: 'NEW', isQualified: null, contactedAt: null, firstContactAt: null, lastOutboundAt: null, lastFollowUpAt: null,
  needsConfirmedAt: null, quotedAt: null, quotations: [], deals: [], ...overrides,
});

test('funnel: the furthest step a customer reached, 有效 by the shared rule', () => {
  assert.equal(funnelDepth(facts()), 0);
  assert.equal(funnelDepth(facts({ stage: 'CONTACTED', contactedAt: at('2026-09-01') })), 1);
  assert.equal(funnelDepth(facts({ lastFollowUpAt: at('2026-09-01') })), 1, 'a logged call is contact too');
  assert.equal(funnelDepth(facts({ stage: 'REPLIED', isQualified: true })), 2);
  assert.equal(funnelDepth(facts({ stage: 'REPLIED', isQualified: true, needsConfirmedAt: at('2026-09-02') })), 3);
  assert.equal(funnelDepth(facts({ stage: 'LOST', isQualified: true, quotedAt: at('2026-09-03') })), 4, 'a lost customer who was quoted got that far');
  assert.equal(funnelDepth(facts({ stage: 'WON', isQualified: true, deals: [{}] })), 5);
  assert.equal(funnelDepth(facts({ stage: 'INVALID', isQualified: false, contactedAt: at('2026-09-01'), quotedAt: at('2026-09-03') })), 1, '无效 never counts as 有效');
  assert.deepEqual(funnelCounts([0, 1, 2, 5]), [4, 3, 2, 1, 1, 1]);
  assert.equal(weakestStep([10, 8, 2, 2, 1, 1]), 2);
  assert.equal(weakestStep([10, 8, 2, 2, 1, 0]), 5);
  assert.equal(weakestStep([10, 8, 2, 2, 1, 0], 5), 2, 'steps after too few customers are not judged');
  assert.equal(weakestStep([0, 0, 0, 0, 0, 0]), -1);
});

test('where a customer is now: one place each, first rule wins', () => {
  const status = (overrides: Record<string, unknown>) => customerStatus({ ...facts(), pendingAssignment: false, outreachState: '', ...overrides } as Parameters<typeof customerStatus>[0]);
  assert.equal(status({ stage: 'FOLLOW_UP', deals: [{}] }), 'WON');
  assert.equal(status({ stage: 'INVALID', pendingAssignment: true }), 'INVALID');
  assert.equal(status({ stage: 'PAUSED' }), 'LOST');
  assert.equal(status({ pendingAssignment: true }), 'POOL');
  assert.equal(status({ stage: 'QUOTED', isQualified: true }), 'QUOTED');
  assert.equal(status({ outreachState: 'ICEBREAK' }), 'FIRST_CONTACT', 'nobody has written yet');
  assert.equal(status({ contactedAt: at('2026-09-01'), outreachState: 'DORMANT' }), 'DORMANT');
  assert.equal(status({ contactedAt: at('2026-09-01'), outreachState: 'ICEBREAK' }), 'ICEBREAK');
  assert.equal(status({ contactedAt: at('2026-09-01'), stage: 'REPLIED', isQualified: true }), 'CONVERSING');
});

test('first contact, medians, response turns and the week grid', () => {
  const now = at('2026-09-10T12:00:00Z'), assigned = at('2026-09-10T10:00:00Z'), due = at('2026-09-10T10:05:00Z');
  assert.deepEqual(firstContact({ firstContactDueAt: due, firstContactAt: at('2026-09-10T10:03:00Z'), contactedAt: null, assignedAt: assigned }, now), { onTime: true, overdue: false, minutes: 3 });
  assert.deepEqual(firstContact({ firstContactDueAt: due, firstContactAt: null, contactedAt: at('2026-09-10T10:20:00Z'), assignedAt: assigned }, now), { onTime: false, overdue: false, minutes: 20 });
  assert.deepEqual(firstContact({ firstContactDueAt: due, firstContactAt: null, contactedAt: null, assignedAt: assigned }, now), { onTime: false, overdue: true, minutes: null });
  assert.equal(firstContact({ firstContactDueAt: at('2026-09-10T13:00:00Z'), firstContactAt: null, contactedAt: null, assignedAt: assigned }, now), null, 'not due yet');
  assert.equal(firstContact({ firstContactDueAt: null, firstContactAt: null, contactedAt: null, assignedAt: null }, now), null);

  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2);
  assert.equal(median([]), null);
  assert.equal(median([1, Infinity, Infinity]), Infinity);
  assert.deepEqual([0, 5, 6, 30, 31, 60, 240, 1440, 1441, Infinity].map(speedBucket), [0, 0, 1, 1, 2, 2, 3, 4, 5, 5]);

  const group = (key: string, direction: 'INBOUND' | 'OUTBOUND', iso: string) => ({ key, direction, at: at(iso) });
  const groups = [
    group('in1', 'INBOUND', '2026-09-10T10:00:00Z'), group('in2', 'INBOUND', '2026-09-10T10:20:00Z'), group('out1', 'OUTBOUND', '2026-09-10T10:30:00Z'),
    group('auto', 'INBOUND', '2026-09-10T11:00:00Z'), group('in3', 'INBOUND', '2026-09-10T12:00:00Z'),
  ];
  const auto = (key: string) => key === 'auto';
  assert.deepEqual(responseTurns(groups, auto, at('2026-09-10T12:30:00Z')).map(turn => turn.minutes), [30, null], 'two questions are one wait; an auto reply starts none');
  assert.deepEqual(responseTurns(groups, auto, at('2026-09-11T13:00:00Z')).map(turn => turn.minutes), [30, Infinity]);

  const quiet = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  assert.equal(busiestHours(quiet), null);
  const busy = Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => hour >= 15 && hour < 18 ? (day < 5 ? 4 : 2) : 0));
  assert.equal(busiestHours(busy), '15–18 点');
  assert.equal(weekendDifference(busy), -50);
  const late = Array.from({ length: 7 }, () => Array.from({ length: 24 }, (_, hour) => hour >= 21 ? 5 : 0));
  assert.equal(busiestHours(late), '21–24 点');

  assert.deepEqual(gradeChange('Jason 手动调整（原 C）：说要两个柜', 'B'), { from: 'C', to: 'B' });
  assert.deepEqual(gradeChange('Jason 确认 AI 根据客户回复给出的建议（原 未评级）：问了价格', 'A'), { from: '未评级', to: 'A' });
  assert.equal(gradeChange('Jason 手动调整（原 B）', 'B'), null, 'confirmed, not changed');
  assert.equal(gradeChange('表单回答：批发商', 'B'), null);
  assert.equal(countryTimezone('fr'), 'Europe/Paris');
  assert.equal(countryTimezone('XX'), null);
});

test('chart slots and the comparison period follow the selected period', () => {
  assert.deepEqual(trendBuckets({ trend: 'day', trendStartKey: '2026-09-29', endKey: '2026-10-01' }).map(bucket => bucket.label), ['9/29', '9/30', '10/1']);
  assert.deepEqual(trendBuckets({ trend: 'week', trendStartKey: '2026-09-02', endKey: '2026-09-16' }).map(bucket => [bucket.start, bucket.end]),
    [['2026-09-02', '2026-09-06'], ['2026-09-07', '2026-09-13'], ['2026-09-14', '2026-09-16']]);
  assert.deepEqual(trendBuckets({ trend: 'month', trendStartKey: '2025-12-01', endKey: '2026-01-20' }).map(bucket => bucket.label), ['2025/12月', '1月']);
  const pair = periodPair({ start: at('2026-10-01T00:00:00Z'), end: at('2026-11-01T00:00:00Z') }, at('2026-10-11T00:00:00Z'));
  assert.deepEqual(pair, { current: { start: at('2026-10-01T00:00:00Z'), end: at('2026-10-11T00:00:00Z') }, previous: { start: at('2026-09-21T00:00:00Z'), end: at('2026-10-01T00:00:00Z') } });
});

const NOW = at('2026-10-29T12:00:00+08:00');
const SEPTEMBER = { range: 'custom', startDate: '2026-09-01', endDate: '2026-09-30' };

test('客户分析: new leads, A / B and effective customers, where they come from and what they cost in ads', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8), country = `测试国${tag}`;
  const seller = await db.user.create({ data: { name: `Seller ${tag}`, email: `analytics-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const make = (name: string, data: object) => db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, country, source: 'FACEBOOK', ...data } });
  try {
    const inquiry = at('2026-09-10T02:00:00Z');
    const won = await make('Won', { leadGrade: 'A', leadGradeSource: 'AI', inquiryAt: inquiry, stage: 'WON', isQualified: true, contactedAt: inquiry, needsConfirmedAt: inquiry, quotedAt: inquiry });
    await db.deal.create({ data: { customerId: won.id, dealAmount: 1000, productCost: 600, grossProfit: 400, grossMargin: 40, dealDate: at('2026-10-05T02:00:00Z') } });
    await make('Icebreak', { leadGrade: 'A', leadGradeSource: 'HUMAN', leadGradeReason: 'Jason 手动调整（原 C）', inquiryAt: at('2026-09-11T02:00:00Z'), stage: 'CONTACTED',
      assignedAt: at('2026-09-11T02:00:00Z'), firstContactDueAt: at('2026-09-11T02:05:00Z'), firstContactAt: at('2026-09-11T02:03:00Z'), contactedAt: at('2026-09-11T02:03:00Z'), outreachState: 'ICEBREAK', ownerId: seller.id });
    await make('Late', { leadGrade: 'B', leadGradeSource: 'RULE', inquiryAt: at('2026-09-12T02:00:00Z'), assignedAt: at('2026-09-12T02:00:00Z'), firstContactDueAt: at('2026-09-12T02:05:00Z'), source: 'META_CLICK_TO_WHATSAPP' });
    await make('Invalid', { leadGrade: 'C', leadGradeSource: 'AI', inquiryAt: at('2026-09-12T03:00:00Z'), stage: 'INVALID', isQualified: false, contactedAt: at('2026-09-12T04:00:00Z') });
    await make('Pool', { inquiryAt: at('2026-09-20T03:00:00Z'), pendingAssignment: true });
    await make('August', { leadGrade: 'B', inquiryAt: at('2026-08-20T03:00:00Z'), stage: 'REPLIED', isQualified: true });
    await make('October', { leadGrade: 'A', inquiryAt: at('2026-10-02T03:00:00Z') });

    // The ad the won customer came from, and a day of that campaign's spend.
    const campaign = await db.campaign.create({ data: { name: `床垫_FR ${tag}`, channel: 'FACEBOOK', externalId: `camp-${tag}`, currency: 'CNY', status: 'ACTIVE', createdBy: admin.id } });
    await db.marketingMetric.create({ data: { campaignId: campaign.id, metricDate: at('2026-09-15T00:00:00Z'), spend: 300, impressions: 1000, clicks: 50, leads: 4 } });
    await db.customerLeadAttribution.create({ data: { leadKey: `analytics-${tag}`, customerId: won.id, source: 'META_LEAD_ADS', status: 'MATCHED', occurredAt: inquiry,
      campaignId: `camp-${tag}`, campaignName: `床垫_FR ${tag}`, adsetId: `set-${tag}`, adsetName: '法国 25-55', adId: `ad-${tag}`, adName: '卷包展开视频' } });

    const data = await customerAnalytics(actor, { ...SEPTEMBER, country }, NOW);
    // 新增线索 counts every lead; the rest only A / B, and 有效 only those who answered.
    assert.equal(data.total, 5);
    assert.equal(data.previousTotal, 1);
    assert.deepEqual(data.grades.map(grade => [grade.label, grade.count]), [['A', 2], ['B', 1], ['C', 1], ['D', 0], ['未评级', 1]]);
    assert.deepEqual(data.ab, { count: 3, A: 2, B: 1, share: 60, previousShare: 100, points: -40 });
    assert.deepEqual(data.effective, { count: 1, A: 1, B: 0, previous: 1, rate: 33.3, previousRate: 100, points: -66.7 });
    assert.deepEqual([data.quoted, data.won, data.quotedRate, data.wonRate, data.previousQuoted, data.previousWon], [1, 1, 100, 100, 0, 0], 'a deal after the period still counts');
    assert.deepEqual(data.spread, { effective: 1, waiting: 2, other: 1, ungraded: 1 });
    assert.deepEqual({ ...data.firstContact }, { onTime: 1, late: 1, rate: 50, overdue: 1, medianMinutes: 3 });
    assert.deepEqual(data.stuck, { count: 1, overTwoDays: 1 }, 'Icebreak was contacted and has not answered');
    const daily = data.daily.points.filter(point => point.A + point.B + point.waiting);
    assert.deepEqual(daily.map(point => [point.start, point.A, point.B, point.waiting]), [['2026-09-10', 1, 0, 0], ['2026-09-11', 0, 0, 1], ['2026-09-12', 0, 0, 1]]);
    assert.equal(data.daily.points.find(point => point.start === '2026-09-15')?.spend, 300);
    assert.deepEqual(data.steps.map(step => [step.label, step.count]), [['已回复', 0], ['需求确认', 0], ['已报价', 0], ['成交', 1]]);
    assert.deepEqual(data.sources.map(row => [row.key, row.ab, row.effective, row.rate, row.won]), [['FACEBOOK', 2, 1, 50, 1], ['META_CLICK_TO_WHATSAPP', 1, 0, 0, 0]]);
    assert.deepEqual(data.owners.map(row => [row.label, row.ab, row.effective]), [[admin.name, 2, 1], [`Seller ${tag}`, 1, 0]]);
    assert.deepEqual(data.people.map(person => [person.name, person.grade, person.from, person.step]), [[`Won ${tag}`, 'A', '卷包展开视频', '成交']]);
    // 广告效果: the campaign's spend against the effective customers it brought.
    const row = data.ads.campaigns.find(c => c.key === `camp-${tag}`)!;
    assert.deepEqual([row.spend, row.ab, row.effective, row.won, row.perEffective], [300, 1, 1, 1, 300]);
    assert.ok(data.ads.ads.some(ad => ad.key === `ad-${tag}` && ad.effective === 1 && ad.rate === 100));
    assert.ok(data.ads.adsets.some(set => set.key === `set-${tag}` && set.name === '法国 25-55'));
    assert.ok(data.options.countries.includes(country));

    const onlyA = await customerAnalytics(actor, { ...SEPTEMBER, country, grade: 'A' }, NOW);
    assert.deepEqual([onlyA.total, onlyA.ab.count, onlyA.effective.count], [5, 2, 1], 'the grade narrows A / B, not 新增线索');
    const bad = await customerAnalytics(actor, { ...SEPTEMBER, country, grade: 'C' }, NOW);
    assert.equal(bad.filters.grade, '', 'C is not on this page: a wrong filter in the address shows A + B');
    // A salesperson sees their own leads only.
    const own = await customerAnalytics({ id: seller.id, name: seller.name, email: seller.email, role: 'SALES' }, { ...SEPTEMBER, country }, NOW);
    assert.deepEqual([own.total, own.ab.count, own.effective.count], [1, 1, 0]);
  } finally {
    await db.campaign.deleteMany({ where: { externalId: `camp-${tag}` } });
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.user.delete({ where: { id: seller.id } });
  }
});

test('消息分析: only the chats with effective customers — groups, response speed, who waits and the week grid', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8), country = `测试国${tag}`;
  const make = (name: string, data: object) => db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, country, countryCode: 'FR', ...data } });
  const message = (customerId: string, direction: 'INBOUND' | 'OUTBOUND', iso: string, extra: object = {}) =>
    db.whatsAppMessage.create({ data: { customerId, direction, sentAt: at(iso), content: 'x', raw: '{}', status: direction === 'INBOUND' ? 'RECEIVED' : 'SENT', ...extra } });
  try {
    // Only Template is an effective customer: Phone never answered, Quick is a C lead.
    const a = await make('Template', { leadGrade: 'A', isQualified: true, stage: 'REPLIED', lastInboundAt: at('2026-09-11T05:00:00Z'), lastOutboundAt: at('2026-09-10T03:30:00Z') });
    const b = await make('Phone', { leadGrade: 'B' });
    const c = await make('Quick', { leadGrade: 'C', isQualified: true, stage: 'REPLIED', lastInboundAt: at('2026-09-13T02:00:00Z') });
    await message(a.id, 'OUTBOUND', '2026-09-10T02:00:00Z', { requestId: `t-${tag}`, messageType: 'TEMPLATE' });
    await message(a.id, 'INBOUND', '2026-09-10T03:00:00Z');
    await message(a.id, 'INBOUND', '2026-09-10T03:20:00Z');
    await message(a.id, 'OUTBOUND', '2026-09-10T03:30:00Z', { requestId: `f-${tag}` });
    await message(a.id, 'INBOUND', '2026-09-11T05:00:00Z');
    await message(a.id, 'OUTBOUND', '2026-09-11T06:00:00Z', { requestId: `x-${tag}`, status: 'FAILED' });
    await message(a.id, 'INBOUND', '2026-08-20T02:00:00Z');
    await message(b.id, 'OUTBOUND', '2026-09-12T02:00:00Z');
    await message(c.id, 'INBOUND', '2026-09-13T02:00:00Z');
    await message(c.id, 'OUTBOUND', '2026-09-13T02:03:00Z', { requestId: `q-${tag}` });

    const data = await messageAnalytics(actor, { ...SEPTEMBER, country }, NOW);
    assert.equal(data.effectiveCustomers, 1);
    assert.deepEqual(data.inbound, { groups: 3, customers: 1, change: 200, previous: 1 });
    assert.equal(data.outbound.groups, 2, 'a failed send is not counted, nor messages to customers who are not effective');
    assert.deepEqual(data.outbound.channels.map(channel => [channel.key, channel.groups]), [['BOS_FREE', 1], ['BOS_TEMPLATE', 1], ['PHONE', 0]]);
    assert.equal(data.speed.median, 30, 'turns of 30 minutes and never');
    assert.equal(data.speed.decided, 2);
    assert.deepEqual(data.speed.buckets.map(bucket => bucket.count), [0, 1, 0, 0, 0, 1]);
    assert.equal(data.daily.points.find(point => point.start === '2026-09-10')?.speed, 30);
    assert.equal(data.heatmap.cells.flat().reduce((sum, value) => sum + value, 0), 3);
    // 2026-09-10 03:00 and 03:20 UTC are Thursday 11 o'clock in Beijing.
    assert.equal(data.heatmap.cells[3][11], 2);
    assert.deepEqual({ total: data.waiting.total, late: data.waiting.late, lateA: data.waiting.lateA, names: data.waiting.people.map(p => p.name) },
      { total: 1, late: 1, lateA: 1, names: [`Template ${tag}`] }, 'the customer wrote last and is still waiting');
    assert.deepEqual(data.states.map(state => [state.key, state.count]), [['US', 1], ['THEM', 0], ['QUIET', 0]]);
    assert.deepEqual(data.owners.map(owner => [owner.name, owner.sent, owner.received, owner.customers, owner.median, owner.waiting]), [[admin.name, 2, 3, 1, 30, 1]]);

    const local = await messageAnalytics(actor, { ...SEPTEMBER, country, clock: 'local' }, NOW);
    assert.equal(local.heatmap.cells[3][5], 2, 'the same messages are at 5 in Paris');
    assert.equal(local.clock.unknown, 0);

    const phone = await messageAnalytics(actor, { ...SEPTEMBER, country, channel: 'PHONE' }, NOW);
    assert.equal(phone.outbound.groups, 0);
    assert.equal(phone.inbound.groups, 3, 'the sending filter only narrows our messages');
    const onlyB = await messageAnalytics(actor, { ...SEPTEMBER, country, grade: 'B' }, NOW);
    assert.deepEqual([onlyB.inbound.groups, onlyB.outbound.groups, onlyB.effectiveCustomers], [0, 0, 0]);
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.$disconnect();
  }
});
