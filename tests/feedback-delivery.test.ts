import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { saveCustomer,addDeal } from '../services/customer-service';
import { deliverAdvertisingFeedback } from '../services/advertising-feedback-service';
import { deleteTestCustomers } from './identity-test-cleanup';

test('feedback claims are exclusive and network retries retain the same event_id and actual value',async()=>{
  const actor=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});const oldEnv={...process.env};const original=globalThis.fetch;
  let customerId='';const deliveries:{event_id:string;custom_data:{value?:number;currency?:string};user_data:{ph?:string[]}}[]=[];
  try{
    const c=await saveCustomer({name:`Feedback ${randomUUID()}`,ownerId:actor.id,whatsapp:'+442079460017'},actor);customerId=c.id;
    await addDeal(c.id,{dealAmount:2999.99,productCost:1999.99,currency:'USD',dealDate:new Date().toISOString()},actor);
    process.env.META_FEEDBACK_ENABLED='true';process.env.META_DATASET_ID='dataset-test';process.env.META_CAPI_ACCESS_TOKEN='delivery-test-token';
    let first=true;
    globalThis.fetch=async(input,init)=>{
      assert.ok(!String(input).includes('delivery-test-token'));assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer delivery-test-token');
      const event=JSON.parse(String(init?.body)).data[0];deliveries.push(event);
      if(event.event_id.startsWith('purchase:')&&event.custom_data.value===2999.99&&first){first=false;return Response.json({error:{code:2}},{status:500});}
      return Response.json({events_received:1});
    };
    await Promise.all([deliverAdvertisingFeedback({limit:50},actor),deliverAdvertisingFeedback({limit:50},actor)]);
    const purchase=await db.advertisingFeedback.findFirstOrThrow({where:{customerId,eventName:'Purchase'}});
    assert.equal(purchase.status,'FAILED');assert.equal(deliveries.filter(e=>e.event_id===purchase.eventId).length,1);
    await db.advertisingFeedback.update({where:{id:purchase.id},data:{nextAttemptAt:new Date(Date.now()-1)}});
    await deliverAdvertisingFeedback({limit:50},actor);
    const retry=deliveries.filter(e=>e.event_id===purchase.eventId);assert.equal(retry.length,2);assert.deepEqual(retry[0],retry[1]);
    assert.equal(retry[0].custom_data.value,2999.99);assert.equal(retry[0].custom_data.currency,'USD');assert.match(retry[0].user_data.ph![0],/^[a-f0-9]{64}$/);
    assert.equal((await db.advertisingFeedback.findUniqueOrThrow({where:{id:purchase.id}})).status,'SENT');
    const count=deliveries.length;await deliverAdvertisingFeedback({limit:50},actor);assert.equal(deliveries.length,count);
    await assert.rejects(deliverAdvertisingFeedback({}, {...actor,role:'SALES'}),/管理员/);
  }finally{
    globalThis.fetch=original;for(const key of ['META_FEEDBACK_ENABLED','META_DATASET_ID','META_CAPI_ACCESS_TOKEN'])if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];
    if(customerId)await deleteTestCustomers({where:{id:customerId}});
  }
});
