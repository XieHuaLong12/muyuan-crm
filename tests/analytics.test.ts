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

test('客户分析: grades, funnel, places, owners and grading for the period\'s leads', async () => {
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

    const data = await customerAnalytics(actor, { ...SEPTEMBER, country }, NOW);
    assert.equal(data.total, 5);
    assert.equal(data.previousTotal, 1);
    assert.deepEqual(data.grades.map(grade => [grade.label, grade.count]), [['A', 2], ['B', 1], ['C', 1], ['D', 0], ['未评级', 1]]);
    assert.deepEqual(data.good, { count: 3, share: 60, previousShare: 100, points: -40 });
    assert.deepEqual(data.qualified, { count: 1, rate: 20, previousRate: 100, points: -80 });
    assert.equal(data.quoted, 1);
    assert.equal(data.won, 1, 'a deal after the period still counts: the lead got that far');
    assert.deepEqual({ ...data.firstContact }, { onTime: 1, late: 1, rate: 50, overdue: 1, medianMinutes: 3 });
    assert.deepEqual(data.funnel.rows.find(row => row.key === 'all')!.counts, [5, 3, 1, 1, 1, 1]);
    assert.deepEqual(data.funnel.rows.find(row => row.key === 'A')!.counts, [2, 2, 1, 1, 1, 1]);
    assert.deepEqual(Object.fromEntries(data.statuses.map(status => [status.key, status.count])), { WON: 1, ICEBREAK: 1, FIRST_CONTACT: 1, INVALID: 1, POOL: 1 });
    const daily = data.daily.points.filter(point => point.A + point.B + point.C + point.other);
    assert.deepEqual(daily.map(point => [point.start, point.A, point.B, point.C, point.other]), [['2026-09-10', 1, 0, 0, 0], ['2026-09-11', 1, 0, 0, 0], ['2026-09-12', 0, 1, 1, 0], ['2026-09-20', 0, 0, 0, 1]]);
    assert.deepEqual(data.sources.map(source => [source.key, source.total, source.qualifiedRate]), [['FACEBOOK', 4, 25], ['META_CLICK_TO_WHATSAPP', 1, 0]]);
    assert.deepEqual(data.countries.map(row => [row.label, row.total, row.A + row.B]), [[country, 5, 3]]);
    assert.deepEqual(data.owners.map(owner => [owner.name, owner.total, owner.onTimeRate]), [[admin.name, 3, 0], [`Seller ${tag}`, 1, 100], ['待分配', 1, null]]);
    assert.deepEqual(data.grading, { ai: 2, rule: 1, human: 1, changed: 1, ungraded: 1, changes: [{ label: 'C → A', count: 1 }] });
    assert.ok(data.options.countries.includes(country));

    const onlyA = await customerAnalytics(actor, { ...SEPTEMBER, country, grade: 'A' }, NOW);
    assert.equal(onlyA.total, 2);
    const bad = await customerAnalytics(actor, { ...SEPTEMBER, country, grade: 'Z' }, NOW);
    assert.equal(bad.filters.grade, '', 'a wrong filter in the address shows everything instead of failing');
    // A salesperson sees their own leads only.
    const own = await customerAnalytics({ id: seller.id, name: seller.name, email: seller.email, role: 'SALES' }, { ...SEPTEMBER, country }, NOW);
    assert.equal(own.total, 1);
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.user.delete({ where: { id: seller.id } });
  }
});

test('消息分析: groups, reply rate, response speed, templates and the week grid', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8), country = `测试国${tag}`;
  const make = (name: string, data: object) => db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, country, countryCode: 'FR', ...data } });
  const message = (customerId: string, direction: 'INBOUND' | 'OUTBOUND', iso: string, extra: object = {}) =>
    db.whatsAppMessage.create({ data: { customerId, direction, sentAt: at(iso), content: 'x', raw: '{}', status: direction === 'INBOUND' ? 'RECEIVED' : 'SENT', ...extra } });
  try {
    const a = await make('Template', { leadGrade: 'A', outreachState: 'CONVERSING' });
    const b = await make('Phone', { leadGrade: 'B', outreachState: 'ICEBREAK' });
    const c = await make('Quick', { leadGrade: 'C', outreachState: 'SILENT' });
    await message(a.id, 'OUTBOUND', '2026-09-10T02:00:00Z', { requestId: `t-${tag}`, messageType: 'TEMPLATE' });
    await message(a.id, 'INBOUND', '2026-09-10T03:00:00Z');
    await message(a.id, 'INBOUND', '2026-09-10T03:20:00Z');
    await message(a.id, 'OUTBOUND', '2026-09-10T03:30:00Z', { requestId: `f-${tag}` });
    await message(a.id, 'INBOUND', '2026-09-11T05:00:00Z');
    await message(a.id, 'OUTBOUND', '2026-09-11T06:00:00Z', { requestId: `x-${tag}`, status: 'FAILED' });
    await message(b.id, 'OUTBOUND', '2026-09-12T02:00:00Z');
    await message(c.id, 'INBOUND', '2026-09-13T02:00:00Z');
    await message(c.id, 'OUTBOUND', '2026-09-13T02:03:00Z', { requestId: `q-${tag}` });
    await message(c.id, 'INBOUND', '2026-08-20T02:00:00Z');
    await message(c.id, 'OUTBOUND', '2026-08-20T03:00:00Z', { requestId: `p-${tag}` });

    const data = await messageAnalytics(actor, { ...SEPTEMBER, country }, NOW);
    assert.deepEqual(data.inbound, { groups: 4, customers: 2, change: 300 });
    assert.equal(data.outbound.groups, 4, 'a failed send is not counted');
    assert.deepEqual(data.outbound.channels.map(channel => [channel.key, channel.groups]), [['BOS_FREE', 2], ['BOS_TEMPLATE', 1], ['PHONE', 1]]);
    assert.deepEqual({ customers: data.replyRate.customers, replied: data.replyRate.replied, rate: data.replyRate.rate }, { customers: 3, replied: 1, rate: 33.3 });
    assert.deepEqual(data.replyRate.byGrade.map(row => [row.grade, row.rate]), [['A', 100], ['B', 0], ['C', 0]]);
    assert.equal(data.speed.median, 30, 'turns of 30 minutes, 3 minutes and never');
    assert.equal(data.speed.decided, 3);
    assert.equal(data.speed.within5, 33.3);
    assert.deepEqual(data.speed.buckets.map(bucket => bucket.count), [1, 1, 0, 0, 0, 1]);
    assert.equal(data.speed.previousMedian, 60);
    assert.deepEqual(data.speed.byGrade.map(row => [row.grade, row.median]), [['A', 30], ['B', null], ['C', 3]]);
    assert.deepEqual(data.templates, { sent: 1, outsideWindow: 1, replyRate: 100, capped: 0, cap: 2 });
    assert.equal(data.heatmap.cells.flat().reduce((sum, value) => sum + value, 0), 4);
    // 2026-09-10 03:00 and 03:20 UTC are Thursday 11 o'clock in Beijing.
    assert.equal(data.heatmap.cells[3][11], 2);
    assert.equal(data.talked, 3);
    assert.deepEqual(data.states.map(state => [state.key, state.count]), [['ICEBREAK', 1], ['CONVERSING', 1], ['SILENT', 1], ['DORMANT', 0], ['STOPPED', 0]]);

    const local = await messageAnalytics(actor, { ...SEPTEMBER, country, clock: 'local' }, NOW);
    assert.equal(local.heatmap.cells[3][5], 2, 'the same messages are at 5 in Paris');
    assert.equal(local.clock.unknown, 0);

    const phone = await messageAnalytics(actor, { ...SEPTEMBER, country, channel: 'PHONE' }, NOW);
    assert.equal(phone.outbound.groups, 1);
    assert.deepEqual({ customers: phone.replyRate.customers, rate: phone.replyRate.rate }, { customers: 1, rate: 0 });
    assert.equal(phone.inbound.groups, 4, 'the sending filter only narrows our messages');
    const onlyC = await messageAnalytics(actor, { ...SEPTEMBER, country, grade: 'C' }, NOW);
    assert.deepEqual([onlyC.inbound.groups, onlyC.outbound.groups], [1, 1]);
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.$disconnect();
  }
});
