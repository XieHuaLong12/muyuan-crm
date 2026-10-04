import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '../lib/db';
import { normalizeProviderEnvelope,parseGupshup,providerTime } from '../lib/gupshup';
import { ingestWhatsAppWebhook,recordWhatsAppReceipt,replayWhatsAppReceipts } from '../services/whatsapp-webhook-service';
import { customerServiceWindow,serviceWindow } from '../services/whatsapp-window-service';
import { sendWhatsAppMessage } from '../services/whatsapp-message-service';
import { gupshupIntegrationStatus,integrationDebug } from '../services/gupshup-integration-service';
import { deleteTestCustomers } from './identity-test-cleanup';
import { POST } from '../app/api/whatsapp/webhook/route';

const business='+19195550101',peer='+33658917981';
const event=(id:string,phone=peer,text='Please quote compressed sofas',timestamp:unknown=Date.now(),referral?:Record<string,unknown>)=>({
  app:'CTWA_TEST',type:'message',version:2,timestamp,payload:{id,source:phone,type:'text',sender:{phone,name:'CTWA buyer'},payload:{text},...(referral?{referral}:{})}});
const cloud=(id:string,source=business,gs='test-gupshup-app')=>({object:'whatsapp_business_account',gs_app_id:gs,entry:[{changes:[{field:'messages',value:{
  metadata:{display_phone_number:source,phone_number_id:'provider-phone-id'},contacts:[{wa_id:peer.slice(1),profile:{name:'V3 Buyer'}}],
  messages:[{id,from:peer,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Hello from real-format fixture'},
    referral:{source_type:'ad',source_id:'fixture-ad',ctwa_clid:'fixture-click'}}]}}]}]});

test('Gupshup envelope and window: never replace missing/future time with a live service window',()=>{
  const payload=event('fixture');assert.equal(normalizeProviderEnvelope(payload),payload);
  assert.equal(normalizeProviderEnvelope({body:cloud('v3')}).gs_app_id,'test-gupshup-app');
  const parsed=parseGupshup(event('missing',peer,'Hello',undefined));
  assert.equal(parsed.kind,'message');
  assert.equal(providerTime(undefined),null);assert.equal(providerTime(Date.now()+3600000),null);
  assert.equal(serviceWindow(null).conversationWindowStatus,'UNKNOWN');
  const at=new Date(1700000000000);assert.equal(serviceWindow(at,new Date(at.getTime()+86400000)).conversationWindowStatus,'CLOSED');
  assert.equal(serviceWindow(at,new Date(at.getTime()+86399999)).conversationWindowStatus,'OPEN');
});

test('Gupshup CTWA database: concurrent create, immutable referral, scoped window, opt-out, receipts and authenticated V2/V3',async t=>{
  const env={...process.env},created:string[]=[],receiptIds:string[]=[];
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}}),actor={id:admin.id,name:admin.name,email:admin.email,role:'ADMIN'};
  const marker=randomUUID(),adId=`ctwa-ad-${marker}`;
  let calls=0;
  try{
    process.env.GUPSHUP_SOURCE_NUMBER=business;process.env.GUPSHUP_APP_NAME='CTWA_TEST';process.env.GUPSHUP_API_KEY='isolated-test-key';
    process.env.GUPSHUP_WEBHOOK_SECRET='isolated-callback-secret';process.env.META_AD_ACCOUNT_ID=`ctwa-${marker}`;delete process.env.DEEPSEEK_API_KEY;
    await db.adDimension.create({data:{accountId:`ctwa-${marker}`,adId,adName:'Initial Ad Snapshot',adsetId:'set-fixture',adsetName:'Actual Set',campaignId:'campaign-fixture',campaignName:'Actual Campaign',creativeId:'creative-fixture',creativeName:'Actual Creative',syncedAt:new Date()}});
    const input=event(marker,peer,'I import sofas');
    input.payload.referral={source_type:'ad',source_id:adId,source_url:'https://fb.me/test',headline:'Actual heading',body:'Actual body',ctwa_clid:'actual-click-fixture'};
    const results=await Promise.all([ingestWhatsAppWebhook(input),ingestWhatsAppWebhook(input)]);
    const first=await db.whatsAppMessage.findUniqueOrThrow({where:{waMessageId:marker}});created.push(first.customerId);
    assert.equal(results.reduce((n,r)=>n+r.createdCustomers,0),1);assert.equal(results.reduce((n,r)=>n+r.duplicateMessages,0),1);
    const c=await db.customer.findUniqueOrThrow({where:{id:first.customerId}});assert.equal(c.source,'META_CLICK_TO_WHATSAPP');assert.equal(c.phoneE164,peer);
    assert.equal(c.whatsappOptInStatus,'UNKNOWN','incoming ad inquiry is not blanket marketing opt-in');assert.ok(first.conversationId);
    const lead=await db.customerLeadAttribution.findFirstOrThrow({where:{customerId:c.id,source:'CTWA'}});
    assert.equal(lead.adName,'Initial Ad Snapshot');assert.equal(lead.creativeId,'creative-fixture');assert.equal(lead.campaignName,'Actual Campaign');
    await db.adDimension.updateMany({where:{adId},data:{adName:'Changed later'}});await ingestWhatsAppWebhook(input);
    assert.equal((await db.customerLeadAttribution.findUniqueOrThrow({where:{id:lead.id}})).adName,'Initial Ad Snapshot');
    const open=await customerServiceWindow(c.id,actor);assert.equal(open.conversationWindowStatus,'OPEN');
    assert.equal((await customerServiceWindow(c.id,actor,{provider:'gupshup',accountId:'+19195550202'})).conversationWindowStatus,'UNKNOWN');
    await db.whatsAppConversation.updateMany({where:{id:first.conversationId!},data:{lastCustomerMessageAt:new Date(Date.now()-2*86400000)}});
    await db.customer.update({where:{id:c.id},data:{lastInboundAt:new Date()}});
    t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({status:'submitted',messageId:`out-${marker}`});});
    await assert.rejects(sendWhatsAppMessage({customerId:c.id,content:'Blocked free text',requestId:randomUUID()},actor),/24 小时/);assert.equal(calls,0);
    await ingestWhatsAppWebhook(event(`old-${marker}`,peer,'Delayed old message',Date.now()-3*86400000));
    assert.equal((await customerServiceWindow(c.id,actor)).conversationWindowStatus,'CLOSED');
    const unknown=event(`unknown-${marker}`);delete (unknown as {timestamp?:unknown}).timestamp;
    await ingestWhatsAppWebhook(unknown);assert.equal((await customerServiceWindow(c.id,actor)).conversationWindowStatus,'CLOSED');
    const v3=cloud(`v3-${marker}`);v3.entry[0].changes[0].value.messages[0].referral.source_id=adId;
    const request=new NextRequest('https://crm.example/api/whatsapp/webhook',{method:'POST',headers:{'content-type':'application/json','x-webhook-secret':'isolated-callback-secret'},body:JSON.stringify(v3)});
    assert.equal((await POST(request)).status,200);assert.equal((await customerServiceWindow(c.id,actor)).conversationWindowStatus,'OPEN');
    const failed=new NextRequest('https://crm.example/api/whatsapp/webhook',{method:'POST',body:JSON.stringify(v3)});assert.equal((await POST(failed)).status,401);
    await assert.rejects(ingestWhatsAppWebhook(cloud(`wrong-${marker}`,'+19195550202')),/号码/);
    const earlyId=`out-${marker}`,waId=`wamid.${marker}`;
    receiptIds.push(earlyId,waId);
    await recordWhatsAppReceipt({id:waId,gsId:earlyId,status:'READ',provider:'gupshup',accountId:business,occurredAt:new Date()});
    const sent=await sendWhatsAppMessage({customerId:c.id,content:'Hello confirmed buyer',requestId:randomUUID()},actor);
    assert.equal(sent.message.status,'READ','early receipt is replayed after provider ID is saved');assert.ok(sent.message.readAt);assert.equal(calls,1);
    await recordWhatsAppReceipt({id:waId,gsId:earlyId,status:'SENT',provider:'gupshup',accountId:business,occurredAt:new Date()});
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{id:sent.message.id}})).status,'READ');
    await replayWhatsAppReceipts('gupshup',business,earlyId);assert.equal(await db.whatsAppStatusReceipt.count({where:{gsId:earlyId,appliedAt:null}}),0);
    const status=await gupshupIntegrationStatus({},actor);assert.equal(status.status,'LIVE_INBOUND_VERIFIED_WITH_ERROR');
    await assert.rejects(gupshupIntegrationStatus({},{...actor,role:'SALES'}),/管理员/);
    assert.ok((await integrationDebug({q:peer},actor)).checks.some(check=>check.name==='Acquisition attribution'&&check.status==='PASS'));
    await ingestWhatsAppWebhook(event(`stop-${marker}`,peer,'STOP'));
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:c.id}})).whatsappOptInStatus,'OPTED_OUT');
    await assert.rejects(sendWhatsAppMessage({customerId:c.id,content:'After opt out',requestId:randomUUID()},actor),/退订/);assert.equal(calls,1);
    // Same native message ID on another business account is scoped, not dropped by the old global ID.
    process.env.GUPSHUP_SOURCE_NUMBER='+19195550202';await ingestWhatsAppWebhook(input);
    assert.equal(await db.whatsAppMessage.count({where:{customerId:c.id,sourceMessageId:marker}}),2);
  }finally{
    await db.whatsAppStatusReceipt.deleteMany({where:{OR:[{messageId:{in:receiptIds}},{gsId:{in:receiptIds}}]}});
    await db.identityAudit.deleteMany({where:{entityId:{in:created}}});
    await db.task.deleteMany({where:{customerId:{in:created}}});
    await deleteTestCustomers({where:{id:{in:created}}});await db.adDimension.deleteMany({where:{adId}});
    for(const key of ['GUPSHUP_SOURCE_NUMBER','GUPSHUP_APP_NAME','GUPSHUP_API_KEY','GUPSHUP_WEBHOOK_SECRET','META_AD_ACCOUNT_ID','DEEPSEEK_API_KEY']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
  }
});
