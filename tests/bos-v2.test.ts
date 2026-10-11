import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KANBAN_STAGES } from '../lib/bos-kanban';
import { stages } from '../lib/constants';

test('kanban shows every persisted customer stage with the shared stage names',()=>{
 assert.deepEqual(KANBAN_STAGES.map(stage=>stage.key),['NEW','CONTACTED','REPLIED','CATALOG_SENT','NEEDS_CONFIRMED','PRODUCT_CONFIRMED','QUOTED','FOLLOW_UP','ORDER','WON','PAUSED','LOST','INVALID']);
 assert.deepEqual(KANBAN_STAGES.map(stage=>stage.key).sort(),Object.keys(stages).sort());
 for(const column of KANBAN_STAGES)assert.equal(column.label,stages[column.key]);
});
