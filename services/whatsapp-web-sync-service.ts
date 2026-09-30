import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { accessible } from '@/services/customer-service';
import { e164, storedE164, exactCustomerPhone, matchPhone, sourceKey, webBatch, type WebMessage } from '@/lib/whatsapp-web-sync';

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
  const items=messages.map(m=>{
    const key=sourceKey(accountPhone,m);
    if(duplicates.has(key)||seen.has(key))return {sourceMessageId:m.sourceMessageId,phone:e164(m.peerPhone),status:'duplicate' as const,reason:'已同步或已入待认领'};
    seen.add(key);
    const match=matchPhone(m.peerPhone,list);
    return {sourceMessageId:m.sourceMessageId,...match};
  });
  const counts={matched:0,unmatched:0,ambiguous:0,duplicate:0,invalid:0};
  for(const item of items)counts[item.status]++;
  return {items,counts};
}
export async function syncWebMessages(input:unknown,user:Actor,accountPhone:string){
  const batch=webBatch.parse(input);
  if(e164(batch.accountPhone)!==accountPhone)throw new HttpError(403,'当前账号与授权号码不一致');
  const {messages}=batch;
  const list=await customers(user);
  let success=0,skipped=0,failed=0,unmatched=0;
  const errors:{sourceMessageId?:string;message:string}[]=[];
  for(const m of messages){
    const key=sourceKey(accountPhone,m),match=matchPhone(m.peerPhone,list);
    try{
      await db.$transaction(async tx=>{
        if(match.status==='matched'){
          const current=await tx.customer.findFirst({where:{id:match.customer.id,...scope(user)},select:{id:true}});
          if(!current)throw new HttpError(403,'客户权限已变化');
        }
        // The queue row is the unique ledger for both matched and unmatched messages.
        await tx.whatsAppUnmatchedMessage.create({data:{sourceKey:key,userId:user.id,accountPhone,
          conversationId:m.conversationId,sourceMessageId:m.sourceMessageId,peerPhone:match.phone,
          peerName:m.peerName,direction:m.direction,sentAt:new Date(m.sentAt),content:m.text,
          attachments:metadata(m),reason:match.status==='matched'?'MATCHED':match.status==='ambiguous'?'AMBIGUOUS':'NO_MATCH',
          status:match.status==='matched'?'IMPORTED':'PENDING',customerId:match.status==='matched'?match.customer.id:null}});
        if(match.status==='matched')await tx.whatsAppMessage.create({data:dbMessage(m,key,accountPhone,match.customer.id)});
      });
      if(match.status==='matched')success++;else unmatched++;
    }catch(error){
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){skipped++;continue;}
      failed++;errors.push({sourceMessageId:m.sourceMessageId,message:'消息保存失败'});
      console.error('WhatsApp Web sync failure',error instanceof Prisma.PrismaClientKnownRequestError?error.code:error instanceof Error?error.name:'unknown');
    }
  }
  const run=await db.whatsAppSyncRun.create({data:{userId:user.id,accountPhone,success,skipped,failed,unmatched,
    errors:JSON.stringify(errors.slice(0,30))},select:{id:true}});
  return {runId:run.id,success,skipped,failed,unmatched,errors};
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
  const [list,pending]=await Promise.all([
    customers(user),
    db.whatsAppUnmatchedMessage.findMany({where:{userId:user.id,status:'PENDING',peerPhone:{not:null}},orderBy:{createdAt:'asc'}}),
  ]);
  const eligible=pending.map(item=>({item,match:matchPhone(item.peerPhone,list)})).filter(result=>result.match.status==='matched');
  let imported=0,skipped=pending.length-eligible.length;
  for(const {item,match} of eligible.slice(0,200)){
    if(match.status!=='matched')continue;
    const m:WebMessage={sourceMessageId:item.sourceMessageId,conversationId:item.conversationId,
      peerPhone:item.peerPhone,peerName:item.peerName,direction:item.direction as 'inbound'|'outbound',
      sentAt:item.sentAt.toISOString(),text:item.content,attachments:JSON.parse(item.attachments)};
    try{
      const claimed=await db.$transaction(async tx=>{
        const current=await tx.customer.findFirst({where:{id:match.customer.id,...scope(user)},select:{id:true}});
        if(!current)return false;
        const changed=await tx.whatsAppUnmatchedMessage.updateMany({where:{id:item.id,userId:user.id,status:'PENDING'},data:{status:'IMPORTED',reason:'MATCHED',customerId:match.customer.id}});
        if(!changed.count)return false;
        await tx.whatsAppMessage.create({data:dbMessage(m,item.sourceKey,item.accountPhone,match.customer.id)});
        return true;
      });
      if(claimed)imported++;else skipped++;
    }catch(error){
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){skipped++;continue;}
      throw error;
    }
  }
  return {imported,skipped,scanned:pending.length,hasMore:eligible.length>200};
}
export async function claimSyncMessage(input:unknown,user:Actor){
  const {itemId,customerId}=z.object({itemId:z.string().min(1),customerId:z.string().min(1)}).strict().parse(input);
  await accessible(customerId,user);
  const item=await db.whatsAppUnmatchedMessage.findFirst({where:{id:itemId,userId:user.id,status:'PENDING'}});
  if(!item)throw new HttpError(404,'待认领消息不存在');
  const m:WebMessage={sourceMessageId:item.sourceMessageId,conversationId:item.conversationId,
    peerPhone:item.peerPhone,peerName:item.peerName,direction:item.direction as 'inbound'|'outbound',
    sentAt:item.sentAt.toISOString(),text:item.content,attachments:JSON.parse(item.attachments)};
  try{
    await db.$transaction(async tx=>{
      const current=await tx.customer.findFirst({where:{id:customerId,...scope(user)},select:{id:true}});
      if(!current)throw new HttpError(404,'客户不存在或无访问权限');
      const changed=await tx.whatsAppUnmatchedMessage.updateMany({where:{id:itemId,userId:user.id,status:'PENDING'},data:{status:'IMPORTED',customerId}});
      if(!changed.count)throw new HttpError(409,'该消息已被认领');
      await tx.whatsAppMessage.create({data:dbMessage(m,item.sourceKey,item.accountPhone,customerId)});
    });
  }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw new HttpError(409,'该消息已入库');throw error;}
  return {claimed:true};
}
