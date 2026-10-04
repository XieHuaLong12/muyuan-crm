import { deleteTestCustomers } from './identity-test-cleanup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { moveCustomerStage } from '../services/bos-crm-service';

test('CRM board stage move is scoped, records history, and rejects stale moves or direct wins',async()=>{
 const tag=randomUUID();
 const owner=await db.user.create({data:{name:'Board owner',email:`board-${tag}@example.test`,passwordHash:'test',role:'SALES'}});
 const outsider=await db.user.create({data:{name:'Other owner',email:`board-other-${tag}@example.test`,passwordHash:'test',role:'SALES'}});
 const customer=await db.customer.create({data:{name:'Board customer',ownerId:owner.id,stage:'NEW'}});
 const actor={id:owner.id,name:owner.name,email:owner.email,role:owner.role};
 const other={id:outsider.id,name:outsider.name,email:outsider.email,role:outsider.role};
 try{
  await assert.rejects(moveCustomerStage(other,{customerId:customer.id,fromStage:'NEW',toStage:'CONTACTED'}),{status:404});
  await moveCustomerStage(actor,{customerId:customer.id,fromStage:'NEW',toStage:'CONTACTED'});
  const moved=await db.customer.findUniqueOrThrow({where:{id:customer.id}});
  assert.equal(moved.stage,'CONTACTED');assert.ok(moved.contactedAt);
  assert.equal(await db.stageHistory.count({where:{customerId:customer.id,fromStage:'NEW',toStage:'CONTACTED'}}),1);
  await assert.rejects(moveCustomerStage(actor,{customerId:customer.id,fromStage:'NEW',toStage:'REPLIED'}),{status:409});
  await assert.rejects(moveCustomerStage(actor,{customerId:customer.id,fromStage:'CONTACTED',toStage:'WON'}));
  assert.equal((await db.customer.findUniqueOrThrow({where:{id:customer.id}})).stage,'CONTACTED');
 }finally{
  await db.stageHistory.deleteMany({where:{customerId:customer.id}});
  await deleteTestCustomers({where:{id:customer.id}});
  await db.user.deleteMany({where:{id:{in:[owner.id,outsider.id]}}});
  await db.$disconnect();
 }
});
