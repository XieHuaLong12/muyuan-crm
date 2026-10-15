import { Prisma } from '@prisma/client';
import { canonicalPhone, identityKey } from '@/lib/contact-identity';
import { resolveActiveContact } from './contact-identity-service';
import { contactedFeedback, qualifiedFeedback } from './advertising-feedback-service';
import { stageQualifies } from '@/lib/constants';

export async function ensureConversation(tx: Prisma.TransactionClient, input: {
  provider: string; accountId: string; peerId: string; phone?: string | null; name?: string;
  externalId: string; sentAt: Date; direction: string; sourceMessageId: string;
}) {
  const phone = canonicalPhone(input.phone || input.peerId, undefined, true);
  const key = identityKey(input.provider, input.accountId, input.peerId);
  const existing = await tx.whatsAppContact.findUnique({ where: { identityKey: key } });
  // Deleted customers are no longer in the customer center: a manual link to one lapses, and the number is
  // matched among the remaining customers (none → unknown number, several → needs a person).
  const resolved = await resolveActiveContact({ phones: phone ? [phone] : [] }, tx);
  const manual = existing?.status === 'MANUAL' && existing.customerId
    ? await tx.customer.findFirst({ where: { id: existing.customerId, deletedAt: null }, select: { id: true } }) : null;
  const customerId = manual ? manual.id : resolved.status === 'MATCHED' ? resolved.customerId : null;
  const status = customerId ? manual ? 'MANUAL' : 'MATCHED' : resolved.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'UNMATCHED';
  const data = { phoneRaw: input.phone, phoneE164: phone, name: input.name || existing?.name || '', customerId, status,
    matchMethod: status === 'MANUAL' ? 'MANUAL' : customerId ? 'PHONE' : 'NONE', confidence: customerId ? 100 : 0 };
  const contact = await tx.whatsAppContact.upsert({ where: { identityKey: key },
    create: { ...data, identityKey: key, provider: input.provider, accountId: input.accountId, peerId: input.peerId }, update: data });
  if (existing?.customerId && existing.customerId !== customerId) await tx.identityAudit.create({ data: {
    entityType: 'WHATSAPP_CONTACT', entityId: contact.id, fromCustomerId: existing.customerId, toCustomerId: customerId,
    actorId: 'SYSTEM', reason: '联系方式出现冲突或原客户被软删除，暂停自动关联，历史消息保持原归属',
  } });
  const conversationKey = identityKey(input.provider, input.accountId, input.externalId);
  const previous = await tx.whatsAppConversation.findUnique({ where: { identityKey: conversationKey } });
  if (previous && previous.contactId !== contact.id) throw new Error('会话外部 ID 已归属其他联系人');
  const latest = (value?: Date | null) => value && value > input.sentAt ? value : input.sentAt;
  const advances = !previous?.lastMessageAt || input.sentAt >= previous.lastMessageAt;
  const times = { lastMessageAt: latest(previous?.lastMessageAt), lastSyncedAt: new Date(),
    ...(advances ? { syncCursor: input.sourceMessageId } : {}),
    ...(input.direction.toUpperCase() === 'INBOUND' ? { lastInboundAt: latest(previous?.lastInboundAt) } : { lastOutboundAt: latest(previous?.lastOutboundAt) }) };
  const conversation = await tx.whatsAppConversation.upsert({ where: { identityKey: conversationKey },
    create: { identityKey: conversationKey, contactId: contact.id, externalId: input.externalId, ...times }, update: times });
  return { contact, conversation, customerId, status };
}

/** Historical imports preserve min first facts and max last facts, even when delivered out of order. */
export async function messageFacts(tx: Prisma.TransactionClient, customerId: string, at: Date, direction: string) {
  const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
  const last = (value: Date | null) => value && value > at ? value : at;
  const first = (value: Date | null) => value && value < at ? value : at;
  const inbound = direction.toUpperCase() === 'INBOUND';
  const stage=c.stageSource!=='HUMAN'&&['NEW','CONTACTED'].includes(c.stage)?inbound?'REPLIED':c.stage==='NEW'?'CONTACTED':c.stage:null;
  await tx.customer.update({ where: { id: customerId }, data: {
    ...(stage&&stage!==c.stage?{stage,stageSource:'SYSTEM',...(stageQualifies(stage)?{isQualified:true}:{})}:{}),
    lastContactAt: last(c.lastContactAt), lastWhatsAppAt: last(c.lastWhatsAppAt),
    ...(inbound ? { firstReplyAt: first(c.firstReplyAt), lastInboundAt: last(c.lastInboundAt) } : { contactedAt: first(c.contactedAt), lastOutboundAt: last(c.lastOutboundAt) }),
  } });
  if(stage&&stage!==c.stage)await tx.stageHistory.create({data:{customerId,fromStage:c.stage,toStage:stage,changedBy:c.ownerId,note:'SYSTEM: 已入库 WhatsApp 消息事实'}});
  // A customer who writes back is valid from now on (已回复 and later stages).
  if(stage&&stage!==c.stage&&stageQualifies(stage)&&c.isQualified!==true)await qualifiedFeedback(tx,customerId,at);
  if(!inbound)await contactedFeedback(tx,customerId,at);
  await tx.customerIntelligence.upsert({ where: { customerId }, create: { customerId, productsJson: '[]', analysisPending: true }, update: { analysisPending: true } });
}
