import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {saveCustomer,addDeal} from '../services/customer-service';
import {ensureOrderForDeal} from '../services/order-service';
import {handleWebhookPayload,retryPendingMetaLeads} from '../services/meta-lead-service';
import {identityDataQuality} from '../services/identity-analytics-service';
import {reconcileIdentityChain,identityChain} from '../services/identity-chain-service';
import {recordWorkflowEvent} from '../services/workflow-service';
import {deleteTestCustomers,deleteTestOrders} from './identity-test-cleanup';
import {NextRequest} from 'next/server';
import {POST as maintenancePost} from '../app/api/cron/identity-chain/route';

test('identity worker rejects missing and unequal-byte secrets and validates work before database mutations',async()=>{
  const old=process.env.META_SYNC_SECRET;
  try{
    process.env.META_SYNC_SECRET='abc';
    assert.equal((await maintenancePost(new NextRequest('http://localhost/api/cron/identity-chain',{method:'POST',body:'{}'}))).status,401);
    assert.equal((await maintenancePost(new NextRequest('http://localhost/api/cron/identity-chain',{method:'POST',headers:{'x-cron-secret':'éab'},body:'{}'}))).status,401);
    const invalid=await maintenancePost(new NextRequest('http://localhost/api/cron/identity-chain',{method:'POST',headers:{'x-cron-secret':'abc','Content-Type':'application/json'},body:JSON.stringify({kind:'not-a-job'})}));
    assert.equal(invalid.status,400);
  }finally{if(old===undefined)delete process.env.META_SYNC_SECRET;else process.env.META_SYNC_SECRET=old;}
});

test('expired lead credentials are visible and persisted leads recover with immutable creative snapshots',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});const marker=randomUUID(),leadId=`recovery-${marker}`,adId=`snapshot-${marker}`;
  const original=globalThis.fetch,env={...process.env};let customerId='';
  try{
    process.env.META_PAGE_ACCESS_TOKEN='recovery-page-token';process.env.META_ADS_ACCESS_TOKEN='recovery-ad-token';
    globalThis.fetch=async()=>Response.json({error:{code:190,message:'Expired'}},{status:401});
    await handleWebhookPayload({entry:[{id:'recovery-page',changes:[{field:'leadgen',value:{leadgen_id:leadId,form_id:'recovery-form'}}]}]});
    assert.equal((await identityDataQuality({},admin)).leadState,'TOKEN_EXPIRED_ON_LAST_FAILURE');
    globalThis.fetch=async(input)=>{
      const target=decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1)!);
      if(target===adId)return Response.json({id:adId,account_id:'recovery-account',name:'Original ad snapshot',adset_id:'recovery-set',adset:{name:'Original set'},campaign_id:'recovery-campaign',campaign:{name:'Original campaign'},creative:{id:'recovery-creative',name:'Factory video'}});
      assert.equal(target,leadId);
      return Response.json({id:leadId,ad_id:adId,created_time:new Date(Date.now()-10000).toISOString(),field_data:[{name:'full_name',values:['Recovery Buyer']},{name:'phone_number',values:['+442079460021']}]});
    };
    assert.equal((await retryPendingMetaLeads({limit:5},admin)).succeeded,1);
    const lead=await db.customerLeadAttribution.findUniqueOrThrow({where:{leadKey:`meta:${leadId}`}});customerId=lead.customerId!;
    assert.equal(lead.accountId,'recovery-account');assert.equal(lead.creativeId,'recovery-creative');assert.equal(lead.creativeName,'Factory video');assert.equal(lead.adsetName,'Original set');
    const stored=JSON.stringify(lead);await handleWebhookPayload({entry:[{changes:[{field:'leadgen',value:{leadgen_id:leadId}}]}]});assert.equal(JSON.stringify(await db.customerLeadAttribution.findUniqueOrThrow({where:{leadKey:lead.leadKey}})),stored);
    assert.notEqual((await identityDataQuality({},admin)).leadState,'TOKEN_EXPIRED_ON_LAST_FAILURE');
  }finally{
    globalThis.fetch=original;for(const key of ['META_PAGE_ACCESS_TOKEN','META_ADS_ACCESS_TOKEN'])if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];
    await db.metaLeadEvent.deleteMany({where:{leadgenId:leadId}});if(customerId)await deleteTestCustomers({where:{id:customerId}});
  }
});

test('historical submissions without lead IDs backfill idempotently, dry-run stays read-only and human events remain facts',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});const marker=randomUUID();let customerId='';
  try{
    const c=await saveCustomer({name:'Legacy no ID',ownerId:admin.id,whatsapp:'+442079460022'},admin);customerId=c.id;
    const leadKey=`csv:${marker}`;
    const submission=await db.leadSubmission.create({data:{customerId,leadId:'',eventKey:leadKey,ordinal:1,occurredAt:new Date(Date.now()-86400000),values:JSON.stringify({whatsapp:c.whatsapp}),raw:JSON.stringify({ad_id:'legacy-ad'}),filename:'Legacy.csv',fileHash:marker,translationPending:'[]'}});
    const count=await db.customerLeadAttribution.count();const dry=await reconcileIdentityChain({target:'submissions',dryRun:true},admin);
    assert.ok(dry.planned.some(p=>p.id===submission.id&&p.status==='READY'));assert.equal(await db.customerLeadAttribution.count(),count);
    await reconcileIdentityChain({target:'submissions',dryRun:false},admin);await reconcileIdentityChain({target:'submissions',dryRun:false},admin);
    assert.equal(await db.customerLeadAttribution.count({where:{leadKey}}),1);assert.equal((await db.customerLeadAttribution.findUniqueOrThrow({where:{leadKey}})).leadId,null);
    const requestId=randomUUID();await recordWorkflowEvent({customerId,requestId,kind:'CATALOG_SENT',description:'销售核对已发送目录'},admin);await recordWorkflowEvent({customerId,requestId,kind:'CATALOG_SENT',description:'销售核对已发送目录'},admin);
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:customerId}})).stage,'CATALOG_SENT');assert.equal(await db.workflowEvent.count({where:{requestId}}),1);
    await recordWorkflowEvent({customerId,requestId:randomUUID(),kind:'PRODUCT_CONFIRMED',description:'客户确认 Y-601'},admin);
    const trace=await identityChain({customerId},admin);assert.ok(trace.timeline.some(e=>e.kind==='PRODUCT_CONFIRMED'));assert.equal(trace.customer.stageSource,'HUMAN');assert.equal(trace.orders.length,0);
    await assert.rejects(reconcileIdentityChain({target:'customers'},{...admin,role:'SALES'}),/管理员/);
  }finally{if(customerId)await deleteTestCustomers({where:{id:customerId}});}
});

test('upgrade order backfills wait for historical lead reconciliation and never automatically enqueue old Purchase events',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});let customerId='';const marker=randomUUID();
  try{
    const c=await saveCustomer({name:'Legacy order reconciliation',ownerId:admin.id,whatsapp:'+442079460029'},admin);customerId=c.id;
    const deal=await addDeal(customerId,{dealAmount:1800,productCost:1200,currency:'USD',dealDate:new Date().toISOString()},admin);
    await deleteTestOrders({where:{dealId:deal.id}}); // Reproduce an old registered Deal that predates the Order module.
    const leadId=`upgrade-${marker}`;
    await db.leadSubmission.create({data:{customerId,eventKey:`meta:${leadId}`,leadId,ordinal:1,occurredAt:new Date(Date.now()-86400000),values:JSON.stringify({whatsapp:c.whatsapp}),raw:JSON.stringify({ad_id:`legacy-ad-${marker}`,ad_name:'Original legacy ad'}),filename:'Legacy order.csv',fileHash:marker,translationPending:'[]'}});
    const order=await db.$transaction(tx=>ensureOrderForDeal(tx,{dealId:deal.id,customerId,amount:deal.dealAmount,currency:deal.currency,orderDate:deal.dealDate,createdBy:admin.id,historical:true}));
    assert.equal(await db.orderAttribution.count({where:{orderId:order.id}}),0,'startup must not freeze an unknown source before the lead ledger is rebuilt');
    assert.equal(await db.advertisingFeedback.count({where:{orderId:order.id,eventName:'Purchase'}}),0);
    await reconcileIdentityChain({target:'submissions',dryRun:false},admin);await reconcileIdentityChain({target:'orders',dryRun:false},admin);
    const attribution=await db.orderAttribution.findUniqueOrThrow({where:{orderId:order.id}});assert.equal(attribution.adId,`legacy-ad-${marker}`);assert.equal(attribution.lastLeadKey,`meta:${leadId}`);
    assert.equal(await db.advertisingFeedback.count({where:{orderId:order.id,eventName:'Purchase'}}),0,'structural reconciliation is not authorization to send historical Purchase');
  }finally{if(customerId)await deleteTestCustomers({where:{id:customerId}});}
});
