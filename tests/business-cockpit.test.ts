import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biggestFunnelLoss, cockpitSelection, customerFunnel, rate } from '../lib/business-cockpit';

test('驾驶舱周期在上海时区使用正确的自然日边界', () => {
 const now = new Date('2026-09-27T04:00:00Z');
 const week = cockpitSelection({ range: 'week' }, 'Asia/Shanghai', now);
 assert.equal(week.start.toISOString(), '2026-09-20T16:00:00.000Z');
 assert.equal(week.end.toISOString(), '2026-09-27T16:00:00.000Z');
 const custom = cockpitSelection({ range: 'custom', startDate: '2026-09-01', endDate: '2026-09-07' }, 'Asia/Shanghai', now);
 assert.equal(custom.start.toISOString(), '2026-08-31T16:00:00.000Z');
 assert.equal(custom.end.toISOString(), '2026-09-07T16:00:00.000Z');
});

test('图表粒度跟随所选范围，旧趋势参数不能把今日或本月变成年度', () => {
 const now = new Date('2026-09-30T04:00:00Z');
 const today = cockpitSelection({ range: 'today', trend: 'year' }, 'Asia/Shanghai', now);
 assert.equal(today.trend, 'day');
 assert.equal(today.trendStartKey, '2026-09-24');
 const month = cockpitSelection({ range: 'month', trend: 'year' }, 'Asia/Shanghai', now);
 assert.equal(month.trend, 'day');
 assert.equal(month.startKey, '2026-09-01');
 const quarter = cockpitSelection({ range: 'quarter' }, 'Asia/Shanghai', now);
 assert.equal(quarter.trend, 'week');
 assert.equal(quarter.startKey, '2026-07-01');
 const year = cockpitSelection({ range: 'year' }, 'Asia/Shanghai', now);
 assert.equal(year.trend, 'month');
 const custom = cockpitSelection({ range: 'custom', startDate: '2026-01-01', endDate: '2026-09-30' }, 'Asia/Shanghai', now);
 assert.equal(custom.trend, 'month');
});

test('漏斗按客户去重且阶段单调递减', () => {
 const base = { stage: 'NEW', isQualified: null, quotedAt: null, quotations: [], deals: [] };
 const funnel = customerFunnel([
  base,
  { ...base, stage: 'CONTACTED' },
  { ...base, stage: 'QUOTED', quotations: [{ id: 'quote' }] },
  { ...base, stage: 'WON', deals: [{ id: 'deal1' }] },
 ]);
 assert.deepEqual(funnel.map(step => step.count), [4, 2, 2, 1, 1]);
 assert.deepEqual(biggestFunnelLoss(funnel), { from: '线索 Lead', to: '有效客户', loss: 2 });
 assert.equal(rate(0, 0), null);
});
