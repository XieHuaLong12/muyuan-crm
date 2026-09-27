import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthPeriod } from '../lib/growth-period';
import { KANBAN_STAGES } from '../lib/bos-kanban';

test('growth ranges respect business timezone and inclusive dates',()=>{
 const now=new Date('2026-09-27T17:30:00.000Z');
 const today=growthPeriod({range:'today'},now,'Asia/Shanghai');
 assert.equal(today.startDate,'2026-09-28');
 assert.equal(today.endDate,'2026-09-28');
 assert.equal(today.start.toISOString(),'2026-09-27T16:00:00.000Z');
 assert.equal(today.end.toISOString(),'2026-09-28T16:00:00.000Z');
 const week=growthPeriod({range:'7d'},now,'Asia/Shanghai');
 assert.equal(week.startDate,'2026-09-22');
 assert.equal(week.endDate,'2026-09-28');
});

test('custom range rejects invalid and reversed dates',()=>{
 const now=new Date('2026-09-27T00:00:00.000Z');
 assert.throws(()=>growthPeriod({range:'custom',startDate:'2026-02-31',endDate:'2026-03-01'},now,'Asia/Shanghai'));
 assert.throws(()=>growthPeriod({range:'custom',startDate:'2026-10-01',endDate:'2026-09-01'},now,'Asia/Shanghai'));
 assert.throws(()=>growthPeriod({range:'custom',startDate:'2024-01-01',endDate:'2026-09-01'},now,'Asia/Shanghai'));
});

test('kanban exposes only persisted customer stages',()=>{
 assert.deepEqual(KANBAN_STAGES.map(stage=>stage.key),['NEW','CONTACTED','REPLIED','NEEDS_CONFIRMED','QUOTED','FOLLOW_UP','ORDER','WON','PAUSED']);
});
