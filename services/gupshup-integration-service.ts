import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,HttpError } from '@/lib/auth';
import { gupshupSource } from '@/lib/gupshup';
import { canonicalPhone } from '@/lib/contact-identity';
import { resolveContact } from './contact-identity-service';
import { customerServiceWindow } from './whatsapp-window-service';
import { identityChain } from './identity-chain-service';

export async function gupshupIntegrationStatus(input:unknown,user:Actor) {
  z.object({}).strict().parse(input);
  if(user.role!=='ADMIN')throw new HttpError(403,'需要管理员权限');
  const source=gupshupSource();
  const account={source:'gupshup',providerAccountId:source||'NOT_CONNECTED'};
  const [incoming,outgoing,webhook,failed,unmatched,unknownConsent,liveConversation]=await Promise.all([
    db.whatsAppMessage.findFirst({where:{...account,direction:'INBOUND'},select:{sentAt:true,providerOccurredAt:true},orderBy:{createdAt:'desc'}}),
    db.whatsAppMessage.findFirst({where:{...account,direction:'OUTBOUND'},select:{sentAt:true,status:true},orderBy:{createdAt:'desc'}}),
    source?db.syncJob.findFirst({where:{provider:'GUPSHUP',jobType:'WEBHOOK',detail:{path:'$.providerAccountId',equals:source}},select:{startedAt:true,completedAt:true,status:true,error:true},orderBy:{startedAt:'desc'}}):Promise.resolve(null),
    db.whatsAppMessage.count({where:{...account,status:'FAILED'}}),
    db.whatsAppUnmatchedMessage.count({where:{provider:'gupshup',status:'PENDING'}}),
    db.customer.count({where:{deletedAt:null,whatsappOptInStatus:'UNKNOWN'}}),
    db.whatsAppConversation.findFirst({where:{contact:{provider:'gupshup',accountId:source||'NOT_CONNECTED'},lastCustomerMessageAt:{not:null}},orderBy:{lastCustomerMessageAt:'desc'},select:{lastCustomerMessageAt:true}}),
  ]);
  const configured=!!(process.env.GUPSHUP_API_KEY?.trim()&&process.env.GUPSHUP_APP_NAME?.trim()&&source&&process.env.GUPSHUP_WEBHOOK_SECRET?.trim());
  return {provider:'GUPSHUP',sourceNumber:source,appName:process.env.GUPSHUP_APP_NAME||null,
    status:!configured?'NOT_CONNECTED':liveConversation?.lastCustomerMessageAt?webhook?.status==='FAILED'?'LIVE_INBOUND_VERIFIED_WITH_ERROR':'LIVE_INBOUND_VERIFIED':'CONFIGURED_UNVERIFIED',
    webhookStatus:webhook?.status||'NOT_VERIFIED',lastIncoming:liveConversation?.lastCustomerMessageAt||incoming?.providerOccurredAt||incoming?.sentAt||null,
    lastOutgoing:outgoing?.sentAt||null,lastOutgoingStatus:outgoing?.status||null,lastWebhook:webhook?.startedAt||null,
    lastError:webhook?.error||null,failedMessages:failed,unmatchedMessages:unmatched,unknownConsentCustomers:unknownConsent,
    templateStatus:'NOT_CONNECTED',credentialsConfigured:configured,
    requiredConfiguration:['GUPSHUP_API_KEY','GUPSHUP_APP_NAME','GUPSHUP_SOURCE_NUMBER (兼容 GUPSHUP_SOURCE)','GUPSHUP_WEBHOOK_SECRET']};
}

export async function integrationDebug(input:unknown,user:Actor) {
  if(user.role!=='ADMIN')throw new HttpError(403,'需要管理员权限');
  const v=z.object({q:z.string().trim().min(1).max(191)}).parse(input);
  const phone=canonicalPhone(v.q,undefined,true);
  const customer=await db.customer.findFirst({where:{id:v.q,deletedAt:null},select:{id:true}});
  const message=await db.whatsAppMessage.findFirst({where:{OR:[{id:v.q},{waMessageId:v.q},{sourceMessageId:v.q},{providerMessageId:v.q}]},select:{customerId:true,id:true,source:true,providerAccountId:true,status:true}});
  const resolved=phone?await resolveContact({phones:[phone]}):null;
  const id=customer?.id||message?.customerId||(resolved?.status==='MATCHED'?resolved.customerId:null);
  if(!id)return {checks:[{name:'Customer',status:resolved?.status==='AMBIGUOUS'?'FAIL':'NOT_FOUND'}],chain:null};
  const chain=await identityChain({customerId:id},user),window=await customerServiceWindow(id,user);
  return {checks:[{name:'Gupshup message',status:chain.messages.some(m=>m.source==='gupshup')||chain.conversations.some(c=>c.contact.provider==='gupshup'&&c.lastCustomerMessageAt)?'PASS':'NOT_FOUND'},
    {name:'Customer',status:'PASS'},{name:'Phone identity',status:chain.customer.phoneE164?'PASS':'NOT_FOUND'},
    {name:'Conversation',status:chain.conversations.length?'PASS':'NOT_FOUND'},
    {name:'Messages',status:chain.messages.length?'PASS':'NOT_FOUND'},
    {name:'AI analysis',status:chain.intelligence?.aiAnalysis?'PASS':chain.intelligence?.analysisError?'FAIL':'NOT_FOUND'},
    {name:'Sent quotation',status:chain.quotations.some(q=>q.status==='SENT'&&q.sentAt)?'PASS':'NOT_FOUND'},
    {name:'Acquisition attribution',status:chain.leads.some(l=>l.adId)?'PASS':'NOT_FOUND'},
    {name:'Order attribution',status:chain.orders.length?chain.orders.every(o=>o.attribution?.status==='ATTRIBUTED')?'PASS':'FAIL':'NOT_FOUND'}],
    customerId:id,message,window,chain};
}
