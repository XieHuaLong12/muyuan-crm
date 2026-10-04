import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { lockIdentity, resolveContact } from './contact-identity-service';
import { ensureConversation, messageFacts } from './conversation-identity-service';
import { canonicalPhone } from '@/lib/contact-identity';
import { retryTransaction } from '@/lib/transaction-retry';
import { e164, storedE164, exactCustomerPhone, matchPhone, sourceKey, webBatch, type WebMessage } from '@/lib/whatsapp-web-sync';
import { exactCrossSourceMessage } from './whatsapp-dedup-service';

export const tokenInput = z.object({label:z.string().trim().min(1).max(80),accountPhone:z.string().max(32)}).strict();
const customerSelect = {id:true,name:true,phone:true,whatsapp:true,whatsappNormalized:true,waId:true} as const;
export async function createSyncToken(input: unknown, user: Actor) {
  const value = tokenInput.parse(input);
  const accountPhone = e164(value.accountPhone);
  if (!accountPhone) throw new HttpError(400, '本人 WhatsApp 号码须为带国家码的国际格式，例如 +8613812345678');
  const token = `wls_${randomBytes(32).toString('base64url')}`;
  const device = await db.whatsAppSyncToken.create({data:{userId:user.id,label:value.label,accountPhone,
    tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+30*86400000)},
    select:{id:true,label:true,accountPhone:true,expiresAt:true,createdAt:true}});
  return {token,device};
}
export async function revokeSyncToken(id:string,user:Actor) {
  const result=await db.whatsAppSyncToken.updateMany({where:{id,userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
  if (!result.count) throw new HttpError(404,'授权不存在');
  return {revoked:true};
}
export async function authSyncToken(header:string|null) {
  const token=/^Bearer (wls_[A-Za-z0-9_-]{43})$/.exec(header||'')?.[1];
  if(!token)throw new HttpError(401,'同步授权无效');
  const hash=createHash('sha256').update(token).digest('hex');
  const device=await db.whatsAppSyncToken.findUnique({where:{tokenHash:hash}});
  if(!device||device.revokedAt||device.expiresAt<=new Date())throw new HttpError(401,'同步授权已过期或已撤销');
  const user=await db.user.findUnique({where:{id:device.userId},select:{id:true,name:true,email:true,role:true}});
  if(!user)throw new HttpError(401,'同步用户不存在');
  await db.whatsAppSyncToken.update({where:{id:device.id},data:{lastUsedAt:new Date()}});
  return {device,user};
}
async function customers(user:Actor){return db.customer.findMany({where:scope(user),select:customerSelect});}
function metadata(m:WebMessage){return JSON.stringify(m.attachments);}
function messageType(m:WebMessage){return m.attachments[0]?.kind.toUpperCase()||'TEXT';}
function dbMessage(m:WebMessage,key:string,accountPhone:string,customerId:string) {
  return {customerId,source:'whatsapp_web',sourceMessageId:m.sourceMessageId,sourceKey:key,
    providerAccountId:accountPhone,sourcePhone:m.direction==='inbound'?e164(m.peerPhone):accountPhone,destinationPhone:m.direction==='inbound'?accountPhone:e164(m.peerPhone),
    attachmentMetadata:metadata(m),direction:m.direction.toUpperCase(),sentAt:new Date(m.sentAt),
    sender:m.direction==='outbound'?accountPhone:(e164(m.peerPhone)||''),waId:e164(m.peerPhone)?.slice(1)||'',
    messageType:messageType(m),content:m.text,raw:'{}',status:m.direction==='inbound'?'RECEIVED':'SENT',
    fileName:m.attachments[0]?.fileName,mimeType:m.attachments[0]?.mimeType};
}
export async function previewWebSync(input:unknown, user:Actor, accountPhone:string){
  const batch=webBatch.parse(input);
  if(e164(batch.accountPhone)!==accountPhone)throw new HttpError(403,'当前账号与授权号码不一致');
  const {messages}=batch;
  const list=await customers(user);
  const keys=messages.map(m=>sourceKey(accountPhone,m));
  const existing=await db.whatsAppUnmatchedMessage.findMany({where:{sourceKey:{in:keys}},select:{sourceKey:true}});
  const duplicates=new Set(existing.map(e=>e.sourceKey));
  const seen=new Set<string>();
  const items=[];
  for(const m of messages){
    const key=sourceKey(accountPhone,m);
    if(duplicates.has(key)||seen.has(key)){items.push({sourceMessageId:m.sourceMessageId,phone:e164(m.peerPhone),status:'duplicate' as const,reason:'已同步或已入待认领'});continue;}
    seen.add(key);
    const match=matchPhone(m.peerPhone,list);
    const global=await resolveContact({phones:e164(m.peerPhone)?[e164(m.peerPhone)!]:[]});
    if(match.status==='matched'&&global.status==='MATCHED'&&await exactCrossSourceMessage(db,{nativeId:m.sourceMessageId,accountPhone,peerPhone:m.peerPhone||'',direction:m.direction,source:'whatsapp_web',customerId:match.customer.id})){
      items.push({sourceMessageId:m.sourceMessageId,phone:match.phone,status:'duplicate' as const,reason:'同一业务号码的原生 WhatsApp ID 已在实时渠道保存'});continue;
    }
    items.push({sourceMessageId:m.sourceMessageId,...(global.status==='AMBIGUOUS'?{status:'ambiguous' as const,phone:e164(m.peerPhone),reason:'号码身份需要人工核对'}:match)});
  }
  const counts={matched:0,unmatched:0,ambiguous:0,duplicate:0,invalid:0};
  for(const item of items)counts[item.status]++;
  return {items,counts};
}
export async function syncWebMessages(input:unknown,user:Actor,accountPhone:string){
  const batch=webBatch.parse(input);
  if(e164(batch.accountPhone)!==accountPhone)throw new HttpError(403,'当前账号与授权号码不一致');
  const {messages}=batch;
  const list=await customers(user);
  const job=await db.syncJob.create({data:{provider:'WHATSAPP',jobType:'LOCAL_BRIDGE',status:'RUNNING',actorId:user.id}});
  let success=0,skipped=0,failed=0,unmatched=0;
  const errors:{sourceMessageId?:string;message:string}[]=[];
  for(const m of messages){
    let crossDuplicate=false;
    const key=sourceKey(accountPhone,m);let match:{status:'matched';phone:string;customer:{id:string;name:string}}|{status:'ambiguous'|'unmatched';phone:string|null;reason:string}=matchPhone(m.peerPhone,list);
    try{
      await retryTransaction(()=>db.$transaction(async tx=>{
        crossDuplicate=false;
        await lockIdentity(tx);
        const linked=await ensureConversation(tx,{provider:'whatsapp_web',accountId:accountPhone,peerId:canonicalPhone(m.peerPhone,undefined,true)||m.conversationId,phone:m.peerPhone,name:m.peerName,externalId:m.conversationId,sentAt:new Date(m.sentAt),direction:m.direction,sourceMessageId:m.sourceMessageId});
        const visible=linked.customerId?await tx.customer.findFirst({where:{id:linked.customerId,...scope(user)},select:{id:true,name:true}}):null;
        match=visible?{status:'matched',phone:linked.contact.phoneE164!,customer:visible}:{status:linked.status==='AMBIGUOUS'?'ambiguous':'unmatched',phone:linked.contact.phoneE164,reason:'等待人工核对'};
        if(match.status==='matched'){
          const current=await tx.customer.findFirst({where:{id:match.customer.id,...scope(user)},select:{id:true}});
          if(!current)throw new HttpError(403,'客户权限已变化');
          crossDuplicate=!!await exactCrossSourceMessage(tx,{nativeId:m.sourceMessageId,accountPhone,peerPhone:m.peerPhone||'',direction:m.direction,source:'whatsapp_web',customerId:match.customer.id});
        }
        // The queue row is the unique ledger for both matched and unmatched messages.
        await tx.whatsAppUnmatchedMessage.create({data:{sourceKey:key,userId:user.id,accountPhone,
          conversationId:m.conversationId,canonicalConversationId:linked.conversation.id,sourceMessageId:m.sourceMessageId,peerPhone:match.phone,
          peerName:m.peerName,direction:m.direction,sentAt:new Date(m.sentAt),content:m.text,
          attachments:metadata(m),reason:crossDuplicate?'CROSS_SOURCE_DUPLICATE':match.status==='matched'?'MATCHED':match.status==='ambiguous'?'AMBIGUOUS':'NO_MATCH',
          status:match.status==='matched'?'IMPORTED':'PENDING',customerId:match.status==='matched'?match.customer.id:null}});
        if(match.status==='matched'&&!crossDuplicate){await tx.whatsAppMessage.create({data:{...dbMessage(m,key,accountPhone,match.customer.id),conversationId:linked.conversation.id}});await messageFacts(tx,match.customer.id,new Date(m.sentAt),m.direction);}
      }));
      if(crossDuplicate)skipped++;else if(match.status==='matched')success++;else unmatched++;
    }catch(error){
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){skipped++;continue;}
      failed++;errors.push({sourceMessageId:m.sourceMessageId,message:'消息保存失败'});
      console.error('WhatsApp Web sync failure',error instanceof Prisma.PrismaClientKnownRequestError?error.code:error instanceof Error?error.name:'unknown');
    }
  }
  const run=await db.whatsAppSyncRun.create({data:{userId:user.id,accountPhone,success,skipped,failed,unmatched,
    errors:JSON.stringify(errors.slice(0,30))},select:{id:true}});
  await db.syncJob.update({where:{id:job.id},data:{status:failed?'PARTIAL':'OK',completedAt:new Date(),processed:messages.length,succeeded:success,failed,detail:{unmatched,skipped},error:failed?'MESSAGE_SAVE_FAILED':null}});
  let analysis:unknown={status:'NOT_CONNECTED'};
  if(process.env.DEEPSEEK_API_KEY)try{analysis=await (await import('./customer-intelligence-service')).processPendingIntelligence({limit:3},user);}catch{analysis={status:'FAILED_RETRYABLE'};}
  return {runId:run.id,success,skipped,failed,unmatched,errors,analysis};
}
export async function syncState(user:Actor){
  const [tokens,runs,unmatched,total]=await Promise.all([
    db.whatsAppSyncToken.findMany({where:{userId:user.id},select:{id:true,label:true,accountPhone:true,createdAt:true,expiresAt:true,revokedAt:true,lastUsedAt:true},orderBy:{createdAt:'desc'},take:30}),
    db.whatsAppSyncRun.findMany({where:{userId:user.id},select:{id:true,accountPhone:true,success:true,skipped:true,failed:true,unmatched:true,errors:true,createdAt:true},orderBy:{createdAt:'desc'},take:30}),
    db.whatsAppUnmatchedMessage.findMany({where:{userId:user.id,status:'PENDING'},select:{id:true,peerPhone:true,peerName:true,direction:true,sentAt:true,content:true,reason:true,createdAt:true},orderBy:{createdAt:'desc'},take:100}),
    db.whatsAppUnmatchedMessage.count({where:{userId:user.id,status:'PENDING'}})]);
  return {tokens,runs:runs.map(r=>({...r,errors:JSON.parse(r.errors) as {sourceMessageId?:string;message:string}[]})),unmatched,unmatchedTotal:total,lastSyncedAt:runs[0]?.createdAt||null};
}
export async function searchSyncCustomers(q:string,user:Actor){
  const query=z.string().trim().max(120).parse(q);
  if(query.length<2)return [];
  const phone=storedE164(query);
  if(phone){
    const list=await db.customer.findMany({where:scope(user),select:{...customerSelect,companyName:true}});
    return list.filter(c=>exactCustomerPhone(phone,c)).slice(0,20);
  }
  return db.customer.findMany({where:{...scope(user),OR:[{name:{contains:query}},{phone:{contains:query}},{whatsapp:{contains:query}},{companyName:{contains:query}}]},select:{id:true,name:true,phone:true,whatsapp:true,companyName:true},take:20});
}
export async function reconcilePendingWebSync(user:Actor){
  return (await import('./identity-chain-service')).reconcilePendingIdentityMessages({limit:200},user);
}
export async function claimSyncMessage(input:unknown,user:Actor){
  return (await import('./identity-chain-service')).claimIdentityMessage(input,user);
}
