import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { commandCenter } from '../services/bos-command-service';
import { growthCenter } from '../services/bos-growth-service';
import { salesQueue } from '../services/bos-sales-service';
import { bosDateRange } from '../lib/bos';

test('BOS read services preserve CRM, scope customers/marketing, and separate currencies',async()=>{
 const tag=randomUUID(),a=await db.user.create({data:{name:'BOS test',email:`bos-${tag}@example.test`,passwordHash:'test',role:'SALES'}}),b=await db.user.create({data:{name:'Other owner',email:`bos-other-${tag}@example.test`,passwordHash:'test',role:'SALES'}});
 const user={id:a.id,name:a.name,email:a.email,role:a.role};const now=new Date(),settings=await db.setting.findUniqueOrThrow({where:{id:'system'}}),range=bosDateRange(now,settings.timezone);
 let customerId='';
 try{
  const c=await db.customer.create({data:{name:'BOS visible',ownerId:a.id,source:'FACEBOOK',aiScore:91,aiIntent:'HIGH',stage:'QUOTED',createdAt:now,lastInboundAt:now,nextFollowUpAt:now}});customerId=c.id;
  await db.customer.create({data:{name:'BOS hidden',ownerId:b.id,source:'TIKTOK',aiScore:99}});
  await db.customer.create({data:{name:'BOS deleted',ownerId:a.id,deletedAt:now}});
  await db.deal.createMany({data:[{customerId:c.id,dealAmount:100,productCost:20,grossProfit:80,grossMargin:.8,currency:'USD',dealDate:now},{customerId:c.id,dealAmount:200,productCost:20,grossProfit:180,grossMargin:.9,currency:'EUR',dealDate:now}]});
  const before=await db.customer.findUniqueOrThrow({where:{id:c.id}}),taskCount=await db.task.count({where:{customerId:c.id}});
  const command=await commandCenter(user,now);assert.equal(command.scope,'PERSONAL');assert.equal(command.newLeads,1);assert.equal(command.followUps,1);assert.equal(command.orders,2);assert.deepEqual(command.revenue.sort((x,y)=>x.currency.localeCompare(y.currency)),[{currency:'EUR',amount:'200'},{currency:'USD',amount:'100'}]);assert.equal(command.funnel.find(s=>s.key==='QUOTED')?.count,1);
  for(const queue of ['today','waiting','high','recent']){const data=await salesQueue(user,{queue},now);assert.deepEqual(data.customers.map(c=>c.id),[customerId]);assert.equal(data.customers[0].leadScore,91);assert.equal(data.customers[0].opportunityStage,'QUOTED');}
  assert.equal((await db.customer.findUniqueOrThrow({where:{id:c.id}})).updatedAt.getTime(),before.updatedAt.getTime());
  await db.customer.update({where:{id:c.id},data:{lastOutboundAt:new Date(now.getTime()+1000)}});
  assert.equal((await salesQueue(user,{queue:'waiting'},now)).total,0);
  assert.equal((await salesQueue(user,{q:'no matching customer'},now)).total,0);
  await assert.rejects(salesQueue(user,{page:0},now));
  const campaign=await db.campaign.create({data:{name:'BOS campaign',channel:'FACEBOOK',createdBy:a.id,currency:'USD'}});
  await db.campaign.create({data:{name:'Hidden campaign',channel:'TIKTOK',createdBy:b.id}});
  const metricDate=new Date(`${range.today}T00:00:00Z`);
  await db.marketingMetric.create({data:{campaignId:campaign.id,metricDate,spend:'25.50',impressions:1000,clicks:50,leads:5}});
  const growth=await growthCenter(user,{tab:'leads'},now);assert.equal(growth.total,1);assert.equal(growth.totalCustomers,1);assert.equal(growth.leads[0].id,c.id);assert.equal(growth.campaigns.length,1);assert.equal(growth.campaigns[0].spend,'25.50');assert.equal(growth.campaigns[0].cpl,'5.10');assert.equal(growth.campaigns[0].ctr,5);assert.equal(growth.channels.find(c=>c.channel==='TIKTOK')?.customerLeads,0);
  assert.equal((await growthCenter(user,{source:'ALIBABA'},now)).total,0);
  assert.equal(await db.task.count({where:{customerId:c.id}}),taskCount);
  // Only the explicit test mutation above changed Customer; read services don't schedule writes.
  const after=await db.customer.findUniqueOrThrow({where:{id:c.id}});assert.equal(after.stage,before.stage);assert.equal(after.aiScore,before.aiScore);
 }finally{
  await db.campaign.deleteMany({where:{createdBy:{in:[a.id,b.id]}}});
  if(customerId)await db.deal.deleteMany({where:{customerId}});
  await db.customer.deleteMany({where:{ownerId:{in:[a.id,b.id]}}});await db.user.deleteMany({where:{id:{in:[a.id,b.id]}}});await db.$disconnect();
 }
});
