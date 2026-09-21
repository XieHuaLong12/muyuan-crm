import test from 'node:test';
import assert from 'node:assert/strict';
import { bosDateRange,opportunityStage,emptyChannels,greeting } from '../lib/bos';
test('BOS uses local day boundaries, including DST',()=>{const r=bosDateRange(new Date('2026-03-08T12:00:00Z'),'America/New_York');assert.equal(r.start.toISOString(),'2026-03-08T05:00:00.000Z');assert.equal(r.end.toISOString(),'2026-03-09T04:00:00.000Z');assert.equal(r.monthStart.toISOString(),'2026-03-01T05:00:00.000Z');});
test('BOS maps existing sales stages without claiming a purchase confirmation is a won deal',()=>{assert.equal(opportunityStage('ORDER'),'NEGOTIATION');assert.equal(opportunityStage('WON'),'WON');assert.equal(opportunityStage('NEEDS_CONFIRMED'),'REPLIED');assert.equal(opportunityStage('LOST'),'LOST');});
test('disconnected marketing spend is unknown, not zero',()=>{assert.ok(emptyChannels('USD').every(c=>c.spend===null&&c.cpl===null&&c.status==='NOT_CONNECTED'));assert.equal(greeting(new Date('2026-09-21T02:00:00Z'),'Asia/Shanghai'),'Good morning');});
