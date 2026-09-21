import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { retryTransaction } from '../lib/transaction-retry';
const conflict = () => new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2034', clientVersion: '6.19.0' });
test('restarts the transaction after 500ms and 1000ms, returning the committed result', async () => {
 const waits:number[]=[];let attempts=0;
 const result=await retryTransaction(async()=>{if(++attempts<3)throw conflict();return 'committed';},async ms=>{waits.push(ms);});
 assert.equal(result,'committed');assert.equal(attempts,3);assert.deepEqual(waits,[500,1000]);
});
test('third conflict propagates the original error without another delay',async()=>{
 const error=conflict();let attempts=0;const waits:number[]=[];
 await assert.rejects(retryTransaction(async()=>{attempts++;throw error;},async ms=>{waits.push(ms);}),e=>e===error);
 assert.equal(attempts,3);assert.deepEqual(waits,[500,1000]);
});
test('validation, optimistic concurrency and unique errors are not retried',async()=>{
 for(const error of [new Error('409 stale task'),new Prisma.PrismaClientKnownRequestError('unique',{code:'P2002',clientVersion:'6.19.0'})]){
  let attempts=0;
  await assert.rejects(retryTransaction(async()=>{attempts++;throw error;},async()=>{assert.fail('must not wait');}),e=>e===error);
  assert.equal(attempts,1);
 }
});
