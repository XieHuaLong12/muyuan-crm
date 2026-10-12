import { deleteTestCustomers, deleteTestOrders } from './identity-test-cleanup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { sourcesAndCountries } from '../services/source-analysis-service';
import { salesQueue } from '../services/bos-sales-service';

test('BOS read services preserve CRM, scope customers/marketing, and separate currencies',async()=>{
 const tag=randomUUID(),a=await db.user.create({data:{name:'BOS test',email:`bos-${tag}@example.test`,passwordHash:'test',role:'SALES'}}),b=await db.user.create({data:{name:'Other owner',email:`bos-other-${tag}@example.test`,passwordHash:'test',role:'SALES'}});
 const user={id:a.id,name:a.name,email:a.email,role:a.role};const now=new Date();
 let customerId='';
 try{
  const c=await db.customer.create({data:{name:'BOS visible',ownerId:a.id,source:'FACEBOOK',aiScore:91,aiIntent:'HIGH',stage:'QUOTED',createdAt:now,lastInboundAt:now,nextFollowUpAt:now}});customerId=c.id;
  await db.customer.create({data:{name:'BOS hidden',ownerId:b.id,source:'TIKTOK',aiScore:99}});
  await db.customer.create({data:{name:'BOS deleted',ownerId:a.id,deletedAt:now}});
  await db.deal.createMany({data:[{customerId:c.id,dealAmount:100,productCost:20,grossProfit:80,grossMargin:.8,currency:'USD',dealDate:now},{customerId:c.id,dealAmount:200,productCost:20,grossProfit:180,grossMargin:.9,currency:'EUR',dealDate:now}]});
  const before=await db.customer.findUniqueOrThrow({where:{id:c.id}}),taskCount=await db.task.count({where:{customerId:c.id}});
  // A salesperson's totals cover only their live customers, and currencies are never added together.
  const totals=(await sourcesAndCountries(user,{range:'today'},new Date(now.getTime()+1000))).totals;assert.equal(totals.inquiries,1);assert.equal(totals.wonCustomers,1);assert.deepEqual(totals.revenue,[{currency:'EUR',amount:'200.00'},{currency:'USD',amount:'100.00'}]);
  for(const queue of ['today','waiting','high','recent']){const data=await salesQueue(user,{queue},now);assert.deepEqual(data.customers.map(c=>c.id),[customerId]);assert.equal(data.customers[0].leadScore,91);assert.equal(data.customers[0].opportunityStage,'QUOTED');}
  assert.equal((await db.customer.findUniqueOrThrow({where:{id:c.id}})).updatedAt.getTime(),before.updatedAt.getTime());
  await db.customer.update({where:{id:c.id},data:{lastOutboundAt:new Date(now.getTime()+1000)}});
  assert.equal((await salesQueue(user,{queue:'waiting'},now)).total,0);
  assert.equal((await salesQueue(user,{q:'no matching customer'},now)).total,0);
  await assert.rejects(salesQueue(user,{page:0},now));
  assert.equal(await db.task.count({where:{customerId:c.id}}),taskCount);
  // Only the explicit test mutation above changed Customer; read services don't schedule writes.
  const after=await db.customer.findUniqueOrThrow({where:{id:c.id}});assert.equal(after.stage,before.stage);assert.equal(after.aiScore,before.aiScore);
 }finally{
  if(customerId)await db.deal.deleteMany({where:{customerId}});
  if(customerId)await deleteTestOrders({where:{customerId}});
  await deleteTestCustomers({where:{ownerId:{in:[a.id,b.id]}}});await db.user.deleteMany({where:{id:{in:[a.id,b.id]}}});await db.$disconnect();
 }
});
