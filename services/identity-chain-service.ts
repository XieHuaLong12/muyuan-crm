import { finalIntelligence } from './customer-intelligence-service';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { canonicalEmail, canonicalPhone, metaLeadKey, sourceInstant } from '@/lib/contact-identity';
import { lockIdentity, rememberCustomerContacts, recordLeadAttribution, resolveContact } from './contact-identity-service';
import { ensureConversation, messageFacts } from './conversation-identity-service';
import { freezeOrderAttribution } from './order-attribution-service';
import { retryTransaction } from '@/lib/transaction-retry';
import { mapLeadFields, type LeadField } from '@/lib/meta-lead-fields';

const id = z.string().trim().min(1).max(191);
export async function adIdentityChain(input:unknown,user:Actor){
  const q=z.object({adId:id,page:z.coerce.number().int().min(1).max(10000).default(1)}).parse(input);
  const where={adId:q.adId,status:'MATCHED',customer:scope(user)};
  const [leads,total]=await Promise.all([
    db.customerLeadAttribution.findMany({where,orderBy:[{occurredAt:'desc'},{leadKey:'desc'}],skip:(q.page-1)*25,take:25,include:{customer:{select:{id:true,name:true,phoneE164:true,stage:true,isQualified:true,purchaseType:true,quotations:{select:{id:true,quoteNumber:true,status:true,sentAt:true},take:50,orderBy:{createdAt:'desc'}},orders:{where:{attribution:{adId:q.adId}},select:{id:true,orderNo:true,deal:{select:{dealAmount:true,grossProfit:true,currency:true}},attribution:{select:{lastLeadKey:true}}},take:50,orderBy:{orderDate:'desc'}},whatsappContacts:{select:{provider:true,status:true,_count:{select:{conversations:true}}}},_count:{select:{whatsappMessages:true}}}}}}),
    db.customerLeadAttribution.count({where}),
  ]);
  return {query:q,total,leads,limits:{leads:25,quotesPerCustomer:50,ordersPerCustomer:50},definition:'留资可重复；报价是该客户历史事实，订单仅列固定归属于本广告的记录'};
}
export async function identityReview(input:unknown,user:Actor) {
  const q=z.object({q:z.string().trim().max(120).default(''),page:z.coerce.number().int().min(1).max(10000).default(1)}).parse(input);
  const phone=canonicalPhone(q.q,undefined,true);const where={status:'PENDING',...(user.role==='ADMIN'?{}:{userId:user.id})};
  const [messages,leads,customers,messageTotal,leadTotal]=await Promise.all([
    db.whatsAppUnmatchedMessage.findMany({where,select:{id:true,peerName:true,peerPhone:true,content:true,reason:true,provider:true,sentAt:true},orderBy:{createdAt:'asc'},skip:(q.page-1)*25,take:25}),
    user.role==='ADMIN'?db.customerLeadAttribution.findMany({where:{customerId:null},select:{id:true,leadKey:true,leadId:true,phoneRaw:true,emailNormalized:true,adName:true,occurredAt:true,status:true},orderBy:{createdAt:'asc'},skip:(q.page-1)*25,take:25}):Promise.resolve([]),
    q.q.length>=2?db.customer.findMany({where:{...scope(user),OR:[{name:{contains:q.q}},{companyName:{contains:q.q}},{email:{contains:q.q}},...(phone?[{contactIdentities:{some:{kind:'PHONE',normalized:phone}}},{phoneE164:phone},{whatsappNormalized:phone.slice(1)}]:[])]},select:{id:true,name:true,companyName:true,phone:true,whatsapp:true},take:20}):Promise.resolve([]),
    db.whatsAppUnmatchedMessage.count({where}),user.role==='ADMIN'?db.customerLeadAttribution.count({where:{customerId:null}}):Promise.resolve(0),
  ]);
  return {messages,leads,customers,page:q.page,messageTotal,leadTotal};
}
export async function identityChain(input: unknown, user: Actor) {
  const query = z.object({ customerId: id.optional(), orderId: id.optional(), cursor:id.optional(), before: z.string().datetime({ offset: true }).optional() })
    .refine(v => v.customerId || v.orderId, '请选择客户或订单').parse(input);
  const order = query.orderId ? await db.order.findFirst({ where: { id: query.orderId, customer: scope(user) }, include: { attribution: true, deal: true } }) : null;
  if (query.orderId && !order) throw new HttpError(404, '订单不存在或无访问权限');
  const customerId = query.customerId || order!.customerId;
  if (order && order.customerId !== customerId) throw new HttpError(404, '客户与订单不一致');
  const customer = await db.customer.findFirst({ where: { id: customerId, ...scope(user) }, select: { id: true, name: true, phone: true, whatsapp: true, phoneE164: true, inquiryAt: true, contactedAt: true, firstReplyAt: true, quotedAt: true, stage: true, stageSource: true } });
  if (!customer) throw new HttpError(404, '客户不存在或无访问权限');
  const cursor=query.cursor?await db.whatsAppMessage.findFirst({where:{id:query.cursor,customerId},select:{id:true,sentAt:true}}):null;
  if(query.cursor&&!cursor)throw new HttpError(400,'聊天分页位置不合法');
  const before = query.before ? { lt: new Date(query.before) } : undefined;
  const [contacts, leads, conversations, messages, quotations, orders, events,firstQuote,intelligence,followUps] = await Promise.all([
    db.contactIdentity.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' }, take: 100 }),
    db.customerLeadAttribution.findMany({ where: { customerId }, orderBy: [{ occurredAt: 'desc' }, { leadKey: 'desc' }], take: 100 }),
    db.whatsAppConversation.findMany({ where: { contact: { customerId } }, include: { contact: true }, orderBy: { lastMessageAt: 'desc' }, take: 50 }),
    db.whatsAppMessage.findMany({ where: { customerId, ...(cursor?{OR:[{sentAt:{lt:cursor.sentAt}},{sentAt:cursor.sentAt,id:{lt:cursor.id}}]}:before ? { sentAt: before } : {}) }, select: { id: true, conversationId: true, source: true, direction: true, messageType: true, content: true, sentAt: true, status: true }, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 51 }),
    db.quotation.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.order.findMany({ where: { customerId }, include: { attribution: true, deal: true }, orderBy: { orderDate: 'desc' }, take: 50 }),
    db.workflowEvent.findMany({ where: { customerId }, orderBy: { happenedAt: 'desc' }, take: 50 }),
    db.quotation.aggregate({where:{customerId,status:'SENT',sentAt:{not:null}},_min:{sentAt:true}}),
    db.customerIntelligence.findUnique({where:{customerId},select:{updatedAt:true,aiAnalysis:true,humanOverrides:true,summary:true,suggestedStage:true,nextFollowUpAt:true,analysisPending:true,analysisError:true}}),
    db.followUp.findMany({where:{customerId},select:{id:true,followUpAt:true,type:true,content:true},orderBy:{followUpAt:'desc'},take:50}),
  ]);
  const timeline=[...leads.filter(l=>l.occurredAt).map(l=>({kind:'LEAD_SUBMISSION',id:l.id,at:l.occurredAt!,source:l.source})),...messages.slice(0,50).map(m=>({kind:m.direction==='INBOUND'?'INBOUND_MESSAGE':'OUTBOUND_MESSAGE',id:m.id,at:m.sentAt,source:m.source})),...quotations.filter(q=>q.status==='SENT'&&q.sentAt).map(q=>({kind:'QUOTE_SENT',id:q.id,at:q.sentAt!,source:'HUMAN'})),...orders.map(o=>({kind:'ORDER_REGISTERED',id:o.id,at:o.deal?.dealDate||o.orderDate,source:'SYSTEM'})),...events.map(e=>({kind:e.kind,id:e.id,at:e.happenedAt,source:'HUMAN'})),...followUps.map(f=>({kind:'FOLLOW_UP',id:f.id,at:f.followUpAt,source:'HUMAN'}))].sort((a,b)=>a.at.getTime()-b.at.getTime());
  return {intelligence:intelligence?{...intelligence,final:intelligence.aiAnalysis?finalIntelligence(intelligence.aiAnalysis,intelligence.humanOverrides):null}:null,followUps, customer, timeline,contacts, leads, conversations, messages: messages.slice(0, 50),
    nextCursor:messages.length>50?messages[49].id:null,
    nextBefore: messages.length > 50 ? messages[49].sentAt.toISOString() : null, quotations, orders, events, selectedOrder: order,
    limits: { leads: 100, conversations: 50, quotations: 50, orders: 50, events: 50 },
    facts: { inquiryAt: customer.inquiryAt, firstOutboundAt: customer.contactedAt, firstInboundAt: customer.firstReplyAt,
      firstSentQuoteAt: firstQuote._min.sentAt } };
}

export async function claimIdentityMessage(input: unknown, user: Actor) {return assignIdentityMessage(input,user,true);}
async function assignIdentityMessage(input: unknown,user:Actor,manual:boolean) {
  const v = z.object({ itemId: id, customerId: id, reason: z.string().trim().min(1).max(1000).default('人工确认联系方式与客户归属') }).strict().parse(input);
  return retryTransaction(() => db.$transaction(async tx => {
    await lockIdentity(tx);
    const customer = await tx.customer.findFirst({ where: { id: v.customerId, ...scope(user) } });
    const item = await tx.whatsAppUnmatchedMessage.findFirst({ where: { id: v.itemId, status: 'PENDING', ...(user.role === 'ADMIN' ? {} : { userId: user.id }) } });
    if (!customer || !item) throw new HttpError(404, '客户或待认领消息不存在');
    const linked = await ensureConversation(tx, { provider: item.provider, accountId: item.providerAccountId || item.accountPhone,
      peerId: canonicalPhone(item.peerPhone, undefined, true) || item.conversationId, phone: item.peerPhone, name: item.peerName,
      externalId: item.conversationId, sourceMessageId: item.sourceMessageId, sentAt: item.sentAt, direction: item.direction });
    if(!manual&&linked.customerId!==customer.id)throw new HttpError(409,'号码不再唯一匹配，请人工核对');
    // No historical message is moved. This explicit manual assignment governs future ingestion.
    await tx.identityAudit.create({ data: { entityType: 'WHATSAPP_CONTACT', entityId: linked.contact.id,
      fromCustomerId: linked.contact.customerId, toCustomerId: customer.id, actorId: manual?user.id:'SYSTEM', reason: v.reason, detail: { itemId: item.id } } });
    await tx.whatsAppContact.update({ where: { id: linked.contact.id }, data: { customerId: customer.id, status: manual?'MANUAL':'MATCHED', matchMethod: manual?'MANUAL':'PHONE', confidence: 100 } });
    const attachments = JSON.parse(item.attachments) as unknown;
    const media = (!Array.isArray(attachments) && typeof attachments === 'object' && attachments ? attachments : {}) as Record<string, unknown>;
    const existingWaId=await tx.whatsAppMessage.findUnique({where:{waMessageId:item.sourceMessageId},select:{id:true}});
    await tx.whatsAppMessage.create({ data: { customerId: customer.id, conversationId: linked.conversation.id, source: item.provider, sourceKey: item.sourceKey, sourceMessageId: item.sourceMessageId,
      ...(item.provider === 'whatsapp_web' || existingWaId ? {} : { waMessageId: item.sourceMessageId }), direction: item.direction.toUpperCase(), sentAt: item.sentAt,
      content: item.content, waId: item.peerPhone?.replace(/^\+/, '') || '', sender: item.direction === 'inbound' ? item.peerPhone || '' : item.accountPhone,
      messageType: typeof media.messageType === 'string' ? media.messageType : Array.isArray(attachments) && attachments[0]?.kind ? String(attachments[0].kind).toUpperCase() : 'TEXT',
      attachmentMetadata: item.attachments, raw: JSON.stringify(media.raw || {}), status: item.direction === 'inbound' ? 'RECEIVED' : 'SENT' } });
    await tx.whatsAppUnmatchedMessage.update({ where: { id: item.id }, data: { status: 'IMPORTED', reason: manual?'MANUAL':'MATCHED', customerId: customer.id, canonicalConversationId: linked.conversation.id } });
    await messageFacts(tx, customer.id, item.sentAt, item.direction);
    return { claimed: true, customerId: customer.id, conversationId: linked.conversation.id };
  }));
}

export async function claimIdentityLead(input: unknown, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '留资认领需要管理员权限');
  const v = z.object({ leadKey: id, customerId: id, reason: z.string().trim().min(1).max(1000) }).parse(input);
  return retryTransaction(() => db.$transaction(async tx => {
    await lockIdentity(tx);
    const c = await tx.customer.findFirst({ where: { id: v.customerId, ...scope(user) } });
    const lead = await tx.customerLeadAttribution.findUnique({ where: { leadKey: v.leadKey } });
    if (!c || !lead) throw new HttpError(404, '客户或留资不存在');
    if (lead.customerId && lead.customerId !== c.id) throw new HttpError(409, '留资已有归属，不能覆盖历史订单来源');
    await tx.identityAudit.create({ data: { entityType: 'META_LEAD', entityId: lead.id, fromCustomerId: lead.customerId, toCustomerId: c.id, actorId: user.id, reason: v.reason } });
    await recordLeadAttribution(tx, { leadKey:lead.leadKey,source:lead.source,phoneRaw:lead.phoneRaw,phoneE164:lead.phoneE164,emailNormalized:lead.emailNormalized,customerId:c.id,status:'MATCHED',matchMethod:'MANUAL',confidence:100 });
    await tx.customerLeadAttribution.update({ where: { id: lead.id }, data: { customerId: c.id, status: 'MATCHED', matchMethod: 'MANUAL', confidence: 100 } });
    if (lead.leadId) await tx.metaLeadEvent.updateMany({ where: { leadgenId: lead.leadId, customerId: null }, data: { customerId: c.id, status: 'LINKED', error: '', processingStartedAt: null } });
    return { claimed: true, customerId: c.id };
  }));
}

export async function reconcilePendingIdentityMessages(input:unknown,user:Actor){
  const v=z.object({limit:z.coerce.number().int().min(1).max(200).default(100)}).parse(input);
  const pending=await db.whatsAppUnmatchedMessage.findMany({where:{status:'PENDING',peerPhone:{not:null},...(user.role==='ADMIN'?{}:{userId:user.id})},orderBy:{createdAt:'asc'},take:v.limit+1});
  let imported=0,skipped=0,failed=0;
  for(const item of pending.slice(0,v.limit)){
    const resolved=await resolveContact({phones:item.peerPhone?[item.peerPhone]:[]});
    if(resolved.status!=='MATCHED'){skipped++;continue;}
    const visible=await db.customer.findFirst({where:{id:resolved.customerId,...scope(user)},select:{id:true}});
    if(!visible){skipped++;continue;}
    try{await assignIdentityMessage({itemId:item.id,customerId:visible.id,reason:'系统确认国际号码唯一匹配'},user,false);imported++;}catch{failed++;}
  }
  return {imported,skipped,failed,scanned:Math.min(pending.length,v.limit),hasMore:pending.length>v.limit};
}

/** No GET mutation and no automatic production backfill. Each pass returns a resumable cursor. */
export async function reconcileIdentityChain(input: unknown, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '历史身份补齐需要管理员权限');
  const v = z.object({ target: z.enum(['customers', 'submissions', 'events', 'orders', 'messages']), cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100), dryRun: z.boolean().default(true) }).parse(input);
  const paging = { orderBy: { id: 'asc' as const }, take: v.limit + 1, ...(v.cursor ? { cursor: { id: v.cursor }, skip: 1 } : {}) };
  const rows = v.target === 'customers' ? await db.customer.findMany(paging) : v.target === 'submissions' ? await db.leadSubmission.findMany(paging) :
    v.target === 'events' ? await db.metaLeadEvent.findMany({ ...paging, where: { customerId: { not: null } } }) :
      v.target === 'orders' ? await db.order.findMany(paging) : await db.whatsAppMessage.findMany({ ...paging, where: { conversationId: null } });
  let succeeded=0;
  const planned:{id:string;status:string}[]=[];
  const errors: { id: string; reason: string }[] = [];
  for (const row of rows.slice(0, v.limit)) {
    if(v.dryRun){
      try{
        let status='READY';
        if(v.target==='customers'){const c=await db.customer.findUniqueOrThrow({where:{id:row.id}});if(!canonicalPhone(c.phone,c.countryCode)&&!canonicalPhone(c.whatsapp,undefined,true)&&!canonicalEmail(c.email))status='NO_VALID_CONTACT';}
        else if(v.target==='messages'){const m=await db.whatsAppMessage.findUniqueOrThrow({where:{id:row.id},include:{customer:true}});const phone=canonicalPhone(m.waId||m.customer.whatsapp,undefined,true);const match=await resolveContact({phones:phone?[phone]:[]});if(match.status!=='MATCHED'||match.customerId!==m.customerId)throw new Error('CONFLICT');}
        else if(v.target==='orders'){const o=await db.order.findUniqueOrThrow({where:{id:row.id},include:{attribution:true}});status=o.attribution?'ALREADY_LOCKED':await db.customerLeadAttribution.count({where:{customerId:o.customerId,status:'MATCHED',occurredAt:{lte:o.orderDate},adId:{not:null}}})?'READY':'UNATTRIBUTED';}
        else{const s=v.target==='submissions'?await db.leadSubmission.findUniqueOrThrow({where:{id:row.id}}):null;const e=v.target==='events'?await db.metaLeadEvent.findUniqueOrThrow({where:{id:row.id}}):null;if(s){JSON.parse(s.raw);JSON.parse(s.values);}const existing=await db.customerLeadAttribution.findUnique({where:{leadKey:s?.eventKey||metaLeadKey(e!.leadgenId)}});if(existing?.customerId&&existing.customerId!==(s?.customerId||e?.customerId))throw new Error('CONFLICT');status=existing?'ALREADY_RECORDED':'READY';}
        planned.push({id:row.id,status});
      }catch{errors.push({id:row.id,reason:'IDENTITY_CONFLICT_OR_INVALID_DATA'});planned.push({id:row.id,status:'CONFLICT'});}
      continue;
    }
    try {
      await retryTransaction(() => db.$transaction(async tx => {
        await lockIdentity(tx);
        if (v.target === 'customers') { await rememberCustomerContacts(tx, row.id, 'BACKFILL'); return; }
        if (v.target === 'orders') {
          const order = await tx.order.findUniqueOrThrow({ where: { id: row.id } });
          await freezeOrderAttribution(tx, order.id, order.customerId, order.orderDate); return;
        }
        if (v.target === 'messages') {
          const message = await tx.whatsAppMessage.findUniqueOrThrow({ where: { id: row.id }, include: { customer: true } });
          const phone = canonicalPhone(message.waId || message.customer.whatsapp, undefined, true);
          if (!phone) throw new Error('NO_VALID_PHONE');
          // Old records did not store a business account; do not pretend this is an existing provider conversation.
          const linked = await ensureConversation(tx, { provider: message.source, accountId: 'legacy:unknown', peerId: phone,
            phone, externalId: phone, sentAt: message.sentAt, direction: message.direction, sourceMessageId: message.sourceMessageId || message.waMessageId || message.id });
          if (linked.customerId !== message.customerId) throw new Error('AMBIGUOUS_OR_DIFFERENT_CUSTOMER');
          await tx.whatsAppMessage.update({ where: { id: message.id }, data: { conversationId: linked.conversation.id } });
          if (!['FAILED','PENDING','UNKNOWN'].includes(message.status)) await messageFacts(tx, message.customerId, message.sentAt, message.direction);
          return;
        }
        const submission = v.target === 'submissions' ? await tx.leadSubmission.findUniqueOrThrow({ where: { id: row.id } }) : null;
        const event = v.target === 'events' ? await tx.metaLeadEvent.findUniqueOrThrow({ where: { id: row.id } }) : null;
        const raw = submission ? JSON.parse(submission.raw) : (event!.rawPayload as Record<string, unknown>)?.lead || event!.rawPayload;
        const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const val = submission ? JSON.parse(submission.values) as Record<string,string> : {};
        const fields:LeadField[]=Array.isArray(r.field_data)?r.field_data.flatMap(item=>{
          if(!item||typeof item!=='object'||typeof item.name!=='string'||!Array.isArray(item.values))return [];
          return item.values.filter((value:unknown):value is string=>typeof value==='string').map((value:string)=>({name:item.name,label:item.name,value}));
        }):[];
        const mapped=mapLeadFields(fields,{leadgenId:event?.leadgenId||submission?.leadId||'',formId:event?.formId||''});
        const str = (key: string) => typeof r[key] === 'string' ? String(r[key]).replace(/^[a-z]:/i, '') : null;
        const customerId = submission?.customerId || event!.customerId;
        const c = customerId ? await tx.customer.findUnique({ where: { id: customerId } }) : null;
        const leadId=submission?submission.leadId:event!.leadgenId;
        await recordLeadAttribution(tx, { leadKey: submission?.eventKey || metaLeadKey(leadId), leadId: leadId || null, customerId,
          status: customerId ? 'MATCHED' : 'UNMATCHED', matchMethod: 'LEGACY', confidence: 100, source: submission ? 'CSV' : 'WEBHOOK',
          occurredAt: sourceInstant(str('created_time')) || submission?.occurredAt || null, phoneRaw: val.whatsapp || val.phone || mapped.whatsapp || mapped.phone || c?.whatsapp || c?.phone,
          phoneE164: canonicalPhone(val.whatsapp || val.phone || mapped.whatsapp || mapped.phone || c?.whatsapp || c?.phone, undefined, true), emailNormalized: canonicalEmail(val.email || mapped.email || c?.email),
          platform: str('platform') || val.source || null, campaignId: str('campaign_id') || event?.campaignId, campaignName: str('campaign_name') || val.campaignName,
          adsetId: str('adset_id'), adsetName: str('adset_name'), adId: str('ad_id') || event?.adId, adName: str('ad_name') || val.adName,
          creativeId: str('creative_id'), creativeName: str('creative_name'), accountId:str('account_id'), formId: str('form_id') || event?.formId || val.formId, formName: str('form_name') || val.formName, answers: r as Prisma.InputJsonValue },
          [val.phone,val.whatsapp,mapped.phone,mapped.whatsapp].filter((value):value is string=>typeof value==='string').flatMap(raw=>{const normalized=canonicalPhone(raw,undefined,true);return normalized?[{raw,normalized}]:[];}));
      }));
      succeeded++;
    } catch { errors.push({ id: row.id, reason: 'IDENTITY_CONFLICT_OR_INVALID_DATA' }); }
  }
  return { target: v.target, dryRun: v.dryRun, scanned: Math.min(rows.length, v.limit), succeeded, errors,planned,
    nextCursor: rows.length > v.limit ? rows[v.limit - 1].id : null };
}
