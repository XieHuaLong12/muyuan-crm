import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { canonicalPhone } from '../lib/contact-identity';
import { saveCustomer, addDeal } from '../services/customer-service';
import { handleWebhookPayload } from '../services/meta-lead-service';
import { previewMeta, commitMeta } from '../services/meta-import-service';
import { ingestWhatsAppWebhook } from '../services/whatsapp-webhook-service';
import { syncWebMessages } from '../services/whatsapp-web-sync-service';
import { identityChain, adIdentityChain, claimIdentityMessage, claimIdentityLead } from '../services/identity-chain-service';
import { resolveContact } from '../services/contact-identity-service';
import { createQuotation, markQuoteSent } from '../services/quotation-service';
import { analyzeIncrementalCustomer, overrideCustomerIntelligence } from '../services/customer-intelligence-service';
import { deliverAdvertisingFeedback, recomputeAdvertisingFeedback } from '../services/advertising-feedback-service';
import { adsAnalytics, identityDataQuality } from '../services/identity-analytics-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const inbound=(messageId:string,phone:string,account='identity-test-account')=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:account},messages:[{id:messageId,from:phone,type:'text',text:{body:'I am a wholesaler, 20 pcs Y-601 FOB'},timestamp:String(Math.floor(Date.now()/1000))}]}}]}]});
test('Canonical identity handles trunk zero, 00, country-specific local phone and never guesses market',()=>{
  assert.equal(canonicalPhone('+44 (0)20 7946 0018'),'+442079460018');
  assert.equal(canonicalPhone('0044 20 7946 0018'),'+442079460018');
  assert.equal(canonicalPhone('020 7946 0018','GB'),'+442079460018');
  assert.equal(canonicalPhone('0501234567'),null);
  assert.equal(canonicalPhone('12345'),null);
  assert.equal(canonicalPhone('+971501234567 ext 123'),null);
});

test('AI rechecks current stage and ownership after the model request before persisting analysis or follow-up tasks',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});const sales=await db.user.findUniqueOrThrow({where:{email:'sales@example.com'}});const original=globalThis.fetch;const oldKey=process.env.DEEPSEEK_API_KEY;const ids:string[]=[];
  try{
    const one=await saveCustomer({name:`AI race ${randomUUID()}`,ownerId:admin.id},admin);ids.push(one.id);
    const two=await saveCustomer({name:`AI transfer ${randomUUID()}`,ownerId:admin.id},admin);ids.push(two.id);
    process.env.DEEPSEEK_API_KEY='isolated-race-key';let phase=0;
    globalThis.fetch=async input=>{
      assert.ok(String(input).includes('/chat/completions'));
      if(phase++===0)await db.customer.update({where:{id:one.id},data:{stage:'WON',stageSource:'HUMAN'}});
      else await db.customer.update({where:{id:two.id},data:{ownerId:sales.id}});
      return Response.json({choices:[{message:{content:JSON.stringify({score:88,intent:'HIGH',customerType:'WHOLESALE',quality:'A',nextAction:'AI 跟进建议',confidence:95})}}]});
    };
    await analyzeIncrementalCustomer(one.id,admin);
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:one.id}})).stage,'WON');assert.equal(await db.task.count({where:{customerId:one.id,source:'AI'}}),0);
    await assert.rejects(analyzeIncrementalCustomer(two.id,{...admin,role:'SALES'}),/权限/);
    assert.equal(await db.customerIntelligence.count({where:{customerId:two.id}}),0);assert.equal(await db.task.count({where:{customerId:two.id,source:'AI'}}),0);
  }finally{
    globalThis.fetch=original;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;await deleteTestCustomers({where:{id:{in:ids}}});
  }
});

test('A–F: lead → contact → conversation → real quote/order → immutable ad + retryable feedback',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});
  const actor={id:admin.id,name:admin.name,email:admin.email,role:admin.role};
  const marker=randomUUID();const phone='+971507123456';const ids:string[]=[];const leadIds=[`${marker}-1`,`${marker}-2`,`${marker}-expired`,`${marker}-ambiguous`];
  const beforeEnv={...process.env};const originalFetch=globalThis.fetch;
  const leadTime=new Date(Date.now()-2*86400000).toISOString();
  let adId='ad-one';let calls=0;let modelCalls=0;
  const analysis={score:89,intent:'HIGH',customerType:'WHOLESALE',products:['Y-601'],quantity:20,quality:'A',summary:'批发采购20件',nextAction:'确认目的港',reason:'客户明确20件采购',confidence:95,lossReasons:['SHIPPING_TOO_HIGH'],suggestedStage:'QUOTED'};
  try {
    process.env.META_PAGE_ACCESS_TOKEN='identity-test-token';process.env.DEEPSEEK_API_KEY='identity-ai-test';
    globalThis.fetch=async(url,init)=>{
      calls++;
      if(String(url).includes('chat/completions')){modelCalls++;const request=JSON.parse(String(init?.body));const context=JSON.parse(request.messages[1].content);
        assert.ok(context.newMessages.length<=60);assert.equal('phone' in context.customer,false);
        return Response.json({choices:[{message:{content:JSON.stringify(analysis)}}]});}
      const leadId=decodeURIComponent(new URL(String(url)).pathname.split('/').at(-1)!);
      return Response.json({id:leadId,created_time:leadTime,platform:'facebook',ad_id:adId,ad_name:`Snapshot ${adId}`,adset_id:'set-one',adset_name:'Set snapshot',campaign_id:'campaign-one',campaign_name:'Campaign snapshot',field_data:[{name:'full_name',values:['Identity Buyer']},{name:'phone_number',values:[phone]},{name:'business_type',values:['wholesaler']},{name:'order_quantity',values:['20']}]});
    };
    const payload=(leadId:string)=>({entry:[{id:'identity-test-page',changes:[{field:'leadgen',value:{leadgen_id:leadId,form_id:'form-one'}}]}]});
    const first=await handleWebhookPayload(payload(leadIds[0]));assert.equal(first.results[0].status,'CREATED');const customerId=first.results[0].customerId!;ids.push(customerId);
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:customerId}})).inquiryAt?.toISOString(),leadTime);
    assert.equal((await db.customerLeadAttribution.findUniqueOrThrow({where:{leadKey:`meta:${leadIds[0]}`}})).adName,'Snapshot ad-one');
    adId='ad-two';const repeat=await handleWebhookPayload(payload(leadIds[1]));assert.equal(repeat.results[0].customerId,customerId);assert.equal(repeat.results[0].status,'LINKED');
    assert.equal(await db.customerLeadAttribution.count({where:{customerId}}),2);
    const reexport=await previewMeta({filename:'identity.csv',text:`id,created_time,full_name,phone_number,platform\n${leadIds[0]},${leadTime},Different spelling,${phone},fb`},actor);
    assert.equal(reexport.rows[0].status,'IMPORTED');
    const newCsvId=`${marker}-csv`;leadIds.push(newCsvId);
    const csv=await previewMeta({filename:'identity.csv',text:`id,created_time,full_name,phone_number,platform,ad_id,ad_name,campaign_id\n${newCsvId},${leadTime},Identity Buyer,${phone},fb,ad-two,Snapshot ad-two,campaign-one`},actor);
    await commitMeta({token:csv.token,rows:[2],confirmed:true,allowPendingTranslation:true},actor);
    const cross=await handleWebhookPayload(payload(newCsvId));assert.equal(cross.results[0].customerId,customerId);
    assert.equal(await db.leadSubmission.count({where:{eventKey:`meta:${newCsvId}`}}),1);
    const messageId=`message-${marker}`;
    await ingestWhatsAppWebhook(inbound(messageId,phone.replace('+','')));await ingestWhatsAppWebhook(inbound(messageId,phone.replace('+','')));
    const message=await db.whatsAppMessage.findUniqueOrThrow({where:{waMessageId:messageId}});assert.equal(message.customerId,customerId);assert.ok(message.conversationId);
    const ai=await analyzeIncrementalCustomer(customerId,actor);assert.equal(ai.analysis.quantity,20);
    // The customer wrote before we did: not a reply yet, so still 新线索 (docs/METRICS.md 已回复).
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:customerId}})).stage,'NEW');
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:customerId}})).quotedAt,null);
    const intelligence=await db.customerIntelligence.findUniqueOrThrow({where:{customerId}});
    await overrideCustomerIntelligence({customerId,updatedAt:intelligence.updatedAt.toISOString(),overrides:{quality:'B',quantity:25,lossReasons:['MOQ_TOO_HIGH']},reason:'销售已人工确认'},actor);
    const confirmed=await db.customerIntelligence.findUniqueOrThrow({where:{customerId}});const contactFacts=await db.customer.findUniqueOrThrow({where:{id:customerId}});
    assert.equal(confirmed.nextFollowUpAt?.getTime(),contactFacts.lastInboundAt!.getTime()+2*86400000,'manual quality B immediately uses the 48-hour follow-up rule');
    const historical=`late-${marker}`;
    await syncWebMessages({accountPhone:'+8613812345678',messages:[{sourceMessageId:historical,conversationId:'identity-chat',peerPhone:phone,peerName:'Buyer',direction:'inbound',sentAt:new Date(Date.now()-3*86400000).toISOString(),text:'Older message delivered later',attachments:[]}]},actor,'+8613812345678');
    await analyzeIncrementalCustomer(customerId,actor);const current=await db.customerIntelligence.findUniqueOrThrow({where:{customerId}});assert.equal(current.quantity,25);assert.ok(current.aiAnalysis);assert.ok(current.humanOverrides);
    assert.equal(modelCalls,2);await analyzeIncrementalCustomer(customerId,actor);assert.equal(modelCalls,2,'no unchanged re-analysis');
    const quote=await createQuotation({customerId,product:'Y-601',quantity:20,unitPrice:100,currency:'USD',incoterm:'FOB'},actor);
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:customerId}})).quotedAt,null,'draft is not sent');
    await markQuoteSent(quote.id,actor);
    await db.adDimension.create({data:{accountId:`identity-${marker}`,adId:'ad-two',adName:'Current ad',adsetId:'set-one',adsetName:'Set',campaignId:'campaign-one',campaignName:'Campaign',creativeId:'changed-current-creative'}});
    await addDeal(customerId,{dealAmount:2000,productCost:1200,dealDate:new Date().toISOString(),currency:'USD',quantity:20,productModel:'Y-601'},actor);
    const order=await db.order.findFirstOrThrow({where:{customerId},include:{attribution:true,deal:true}});
    assert.equal(order.attribution?.adId,'ad-two');assert.equal(order.attribution?.creativeId,null,'current ad creative is not evidence of the historical lead creative');assert.equal(order.deal?.grossProfit.toString(),'800');
    const frozen=JSON.stringify(order.attribution);
    await db.customerLeadAttribution.updateMany({where:{customerId},data:{adName:'Renamed after order'}});
    await recomputeAdvertisingFeedback({customerId},actor);await recomputeAdvertisingFeedback({customerId},actor);
    assert.equal(await db.advertisingFeedback.count({where:{orderId:order.id,eventName:'Purchase'}}),1);
    assert.equal(JSON.stringify((await db.order.findUniqueOrThrow({where:{id:order.id},include:{attribution:true}})).attribution),frozen);
    const adTrace=await adIdentityChain({adId:'ad-two'},actor);assert.ok(adTrace.leads.some(l=>l.customer?.orders.some(o=>o.id===order.id)));assert.equal((await adIdentityChain({adId:'ad-one'},actor)).leads[0]?.customer?.orders.length,0);assert.equal((await adIdentityChain({adId:'ad-two'},{...actor,id:'other-sales',role:'SALES'})).total,0);
    const chain=await identityChain({orderId:order.id},actor);assert.equal(chain.customer.id,customerId);assert.ok(chain.conversations.length);
    await assert.rejects(identityChain({orderId:order.id},{...actor,id:'other-sales',role:'SALES'}),/权限/);
    assert.equal((await adsAnalytics({group:'creative'},actor)).current.spendStatus,'UNAVAILABLE_FOR_CREATIVE_HISTORY');
    assert.equal((await adsAnalytics({group:'ad',creativeId:'changed-current-creative'},actor)).current.spendStatus,'UNAVAILABLE_FOR_CREATIVE_HISTORY');
    const report=await adsAnalytics({adId:'ad-two',preset:'7d'},actor);assert.equal(report.current.rows.find(r=>r.currency==='USD')?.orders,1);
    assert.ok(report.current.rows.every(r=>r.spend===null),'missing spend is not zero');
    const quality=await identityDataQuality({},actor);assert.equal(quality.feedbackStatus,'NOT_CONNECTED');
    const beforeCalls=calls;assert.equal((await deliverAdvertisingFeedback({},actor)).status,'NOT_CONNECTED');assert.equal(calls,beforeCalls);
    // C: a foreign number stays durable and unlinked.
    const unknown=`unknown-${marker}`;await ingestWhatsAppWebhook(inbound(unknown,'966501234876'));
    assert.equal(await db.whatsAppMessage.count({where:{waMessageId:unknown}}),0);
    const pending=await db.whatsAppUnmatchedMessage.findFirstOrThrow({where:{sourceMessageId:unknown}});assert.equal(pending.reason,'NO_MATCH');
    // D: duplicate number, even one has waId, never auto-selects that customer.
    const duplicate=await db.customer.create({data:{name:'Same phone different customer',ownerId:admin.id,whatsapp:phone,whatsappNormalized:phone.slice(1)}});ids.push(duplicate.id);
    const ambiguous=`ambiguous-${marker}`;const ambiguity=await ingestWhatsAppWebhook(inbound(ambiguous,phone.slice(1)));assert.equal(ambiguity.ambiguous,1);
    assert.equal((await resolveContact({phones:[phone]})).status,'AMBIGUOUS');
    const ambiguousItem=await db.whatsAppUnmatchedMessage.findFirstOrThrow({where:{sourceMessageId:ambiguous}});
    await claimIdentityMessage({itemId:ambiguousItem.id,customerId,reason:'原客户已核对'},actor);
    const afterClaim=`after-claim-${marker}`;await ingestWhatsAppWebhook(inbound(afterClaim,phone.slice(1)));
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{waMessageId:afterClaim}})).customerId,customerId);
    const conflictLead=await handleWebhookPayload(payload(leadIds[3]));assert.equal(conflictLead.results[0].status,'FAILED');assert.equal(conflictLead.results[0].customerId,null);
    // E: expired token preserves failed event and the independent CRM.
    globalThis.fetch=async()=>Response.json({error:{code:190,message:'Token expired'}},{status:401});
    const expired=await handleWebhookPayload(payload(leadIds[2]));assert.equal(expired.results[0].status,'FAILED');assert.equal((await db.customer.findUniqueOrThrow({where:{id:customerId}})).stage,'WON');
    // F: invalid bridge batch fails locally; its rejected payload never changes Meta provenance.
    await assert.rejects(syncWebMessages({accountPhone:'+8613812345678',messages:[{text:'invalid'}]},actor,'+8613812345678'));
    assert.equal(JSON.stringify((await db.order.findUniqueOrThrow({where:{id:order.id},include:{attribution:true}})).attribution),frozen);
  }finally{
    globalThis.fetch=originalFetch;for(const key of ['META_PAGE_ACCESS_TOKEN','DEEPSEEK_API_KEY'])if(beforeEnv[key]===undefined)delete process.env[key];else process.env[key]=beforeEnv[key];
    await db.adDimension.deleteMany({where:{accountId:`identity-${marker}`}});
    await db.customerLeadAttribution.deleteMany({where:{leadId:{in:leadIds}}});await db.metaLeadEvent.deleteMany({where:{leadgenId:{in:leadIds}}});
    await deleteTestCustomers({where:{id:{in:ids}}});
    const contacts=await db.whatsAppContact.findMany({where:{accountId:'identity-test-account'},select:{id:true}});const contactIds=contacts.map(c=>c.id);
    await db.whatsAppUnmatchedMessage.deleteMany({where:{providerAccountId:'identity-test-account'}});
    await db.whatsAppConversation.deleteMany({where:{contactId:{in:contactIds}}});await db.whatsAppContact.deleteMany({where:{id:{in:contactIds}}});
  }
});

test('phone changes preserve historical aliases and phone wins over a different email match',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});const ids:string[]=[];
  try{
    const a=await saveCustomer({name:'Alias buyer',ownerId:admin.id,whatsapp:'+442079460018'},admin);ids.push(a.id);
    const b=await saveCustomer({name:'Email buyer',ownerId:admin.id,email:`identity-${randomUUID()}@example.test`},admin);ids.push(b.id);
    await saveCustomer({name:'Alias buyer',ownerId:admin.id,whatsapp:'+442079460019'},admin,a.id);
    const resolved=await resolveContact({phones:['+442079460018'],email:b.email});assert.equal(resolved.status,'MATCHED');if(resolved.status==='MATCHED')assert.equal(resolved.customerId,a.id);
  }finally{await deleteTestCustomers({where:{id:{in:ids}}});}
});

test('repeat forms keep distinct phone and WhatsApp aliases; Lead and Contacted feedback use stable factual events',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});const marker=randomUUID();let customerId='';const leadIds=[`${marker}-csv`,`${marker}-webhook`];const originalFetch=globalThis.fetch;const oldToken=process.env.META_PAGE_ACCESS_TOKEN;
  try {
    const c=await saveCustomer({name:'Two phone buyer',ownerId:admin.id,whatsapp:'+442079460025'},admin);customerId=c.id;
    const occurredAt=new Date(Date.now()-86400000).toISOString();
    const preview=await previewMeta({filename:'Alias.csv',text:`id,created_time,full_name,phone_number,whatsapp,ad_id,creative_id,creative_name\n${leadIds[0]},${occurredAt},Two phone buyer,+442079460026,+442079460025,alias-ad,alias-creative,Original creative`},admin);
    assert.equal(preview.rows[0].status,'REPEAT');await commitMeta({token:preview.token,rows:[2],confirmed:true},admin);
    const csvLead=await db.customerLeadAttribution.findUniqueOrThrow({where:{leadKey:`meta:${leadIds[0]}`}});assert.equal(csvLead.creativeName,'Original creative');
    assert.equal((await resolveContact({phones:['+442079460026']})).status,'MATCHED');
    process.env.META_PAGE_ACCESS_TOKEN='alias-test-token';
    globalThis.fetch=async()=>Response.json({id:leadIds[1],created_time:occurredAt,field_data:[{name:'full_name',values:['Two phone buyer']},{name:'phone_number',values:['+442079460027']},{name:'whatsapp',values:['+442079460025']}]});
    const payload={entry:[{id:'alias-page',changes:[{field:'leadgen',value:{leadgen_id:leadIds[1]}}]}]};
    assert.equal((await handleWebhookPayload(payload)).results[0].customerId,customerId);
    const resolved=await resolveContact({phones:['+442079460027']});assert.equal(resolved.status,'MATCHED');if(resolved.status==='MATCHED')assert.equal(resolved.customerId,customerId);
    const data={accountPhone:'+8613812345678',messages:[{sourceMessageId:`contact-${marker}`,conversationId:`alias-chat-${marker}`,peerPhone:'+442079460027',peerName:'Buyer',direction:'outbound',sentAt:new Date().toISOString(),text:'Confirmed human contact',attachments:[]}]};
    await syncWebMessages(data,admin,'+8613812345678');await syncWebMessages(data,admin,'+8613812345678');
    await recomputeAdvertisingFeedback({customerId},admin);await recomputeAdvertisingFeedback({customerId},admin);
    assert.equal(await db.advertisingFeedback.count({where:{customerId,eventName:'Lead'}}),2);
    const contact=await db.advertisingFeedback.findMany({where:{customerId,eventName:'Contacted'}});assert.equal(contact.length,1);assert.equal(contact[0].status,'NOT_CONNECTED');
    assert.equal((contact[0].payload as {user_data:{lead_id:string}}).user_data.lead_id,leadIds[1]);
    const profile=await db.customerIntelligence.update({where:{customerId},data:{aiAnalysis:{score:88,intent:'HIGH',customerType:'WHOLESALE',quality:'A',confidence:95},analysisPending:false}});
    const report=await adsAnalytics({adId:'alias-ad'},admin);assert.equal(report.current.rows.reduce((sum,row)=>sum+row.wholesale,0),1,'AI-confirmed wholesale identity must agree with the customer-type analysis even when the raw CRM type is OTHER');
    await overrideCustomerIntelligence({customerId,updatedAt:profile.updatedAt.toISOString(),overrides:{customerType:'PERSONAL'},reason:'销售核对个人采购'},admin);
    const corrected=await adsAnalytics({adId:'alias-ad'},admin);assert.equal(corrected.current.rows.reduce((sum,row)=>sum+row.wholesale,0),0);assert.equal(corrected.current.customerTypes.PERSONAL,1,'human confirmed type takes precedence across both metrics');
  } finally {
    globalThis.fetch=originalFetch;if(oldToken===undefined)delete process.env.META_PAGE_ACCESS_TOKEN;else process.env.META_PAGE_ACCESS_TOKEN=oldToken;
    await db.metaLeadEvent.deleteMany({where:{leadgenId:{in:leadIds}}});if(customerId)await deleteTestCustomers({where:{id:customerId}});
  }
});

test('manual lead claim retains the submitted phone alias; provider accounts and bad phones cannot corrupt another conversation',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});const marker=randomUUID();let customerId='';
  const account=`scope-${marker}`,otherAccount=`other-${marker}`,leadKey=`meta:claim-${marker}`;
  try{
    const c=await saveCustomer({name:'Claim alias buyer',ownerId:admin.id,email:`claim-${marker}@example.test`},admin);customerId=c.id;
    await db.customerLeadAttribution.create({data:{leadKey,source:'WEBHOOK',phoneRaw:'0044 20 7946 0020',phoneE164:'+442079460020',status:'UNMATCHED'}});
    await claimIdentityLead({leadKey,customerId,reason:'销售核对实际联系人'},admin);
    const match=await resolveContact({phones:['+442079460020']});assert.equal(match.status,'MATCHED');if(match.status==='MATCHED')assert.equal(match.customerId,customerId);
    const messageId=`account-message-${marker}`;
    await ingestWhatsAppWebhook(inbound(messageId,'442079460020',account));
    // Identical provider ID on a second account is queued, never silently treated as the original message.
    await ingestWhatsAppWebhook(inbound(messageId,'442079460020',otherAccount));
    assert.equal((await db.whatsAppUnmatchedMessage.findFirstOrThrow({where:{providerAccountId:otherAccount,sourceMessageId:messageId}})).reason,'MESSAGE_ID_CONFLICT');
    assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{waMessageId:messageId},include:{conversation:{include:{contact:true}}}})).conversation?.contact.accountId,account);
    const payload=inbound(`bad-${marker}`,'invalid phone',account);payload.entry[0].changes[0].value.messages.push({id:`good-${marker}`,from:'442079460020',type:'text',text:{body:'Actual business message'},timestamp:String(Math.floor(Date.now()/1000))});
    await ingestWhatsAppWebhook(payload);
    assert.ok(await db.whatsAppMessage.findUnique({where:{waMessageId:`good-${marker}`}}));
    assert.equal((await db.whatsAppUnmatchedMessage.findFirstOrThrow({where:{sourceMessageId:`bad-${marker}`}})).reason,'INVALID_PHONE');
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:customerId}})).stage,'NEW','manual stage remains authoritative');
  }finally{
    await db.customerLeadAttribution.deleteMany({where:{leadKey}});await db.whatsAppUnmatchedMessage.deleteMany({where:{providerAccountId:{in:[account,otherAccount]}}});
    if(customerId)await deleteTestCustomers({where:{id:customerId}});
    const contacts=await db.whatsAppContact.findMany({where:{accountId:{in:[account,otherAccount]}},select:{id:true}});
    await db.whatsAppConversation.deleteMany({where:{contactId:{in:contacts.map(c=>c.id)}}});await db.whatsAppContact.deleteMany({where:{id:{in:contacts.map(c=>c.id)}}});
  }
});
