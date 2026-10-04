import { Prisma } from '@prisma/client';
import { canonicalPhone, identityKey } from '@/lib/contact-identity';
import { resolveContact } from './contact-identity-service';
import { contactedFeedback } from './advertising-feedback-service';

export async function ensureConversation(tx: Prisma.TransactionClient, input: {
  provider: string; accountId: string; peerId: string; phone?: string | null; name?: string;
  externalId: string; sentAt: Date; direction: string; sourceMessageId: string;
}) {
  const phone = canonicalPhone(input.phone || input.peerId, undefined, true);
  const key = identityKey(input.provider, input.accountId, input.peerId);
  const existing = await tx.whatsAppContact.findUnique({ where: { identityKey: key } });
  const resolved = await resolveContact({ phones: phone ? [phone] : [] }, tx);
  const candidateId = existing?.status === 'MANUAL' ? existing.customerId : resolved.status === 'MATCHED' ? resolved.customerId : null;
  const active = candidateId ? await tx.customer.findUnique({ where: { id: candidateId }, select: { deletedAt: true } }) : null;
  const customerId = active && !active.deletedAt ? candidateId : null;
  const status = customerId ? existing?.status === 'MANUAL' ? 'MANUAL' : 'MATCHED' : resolved.status === 'AMBIGUOUS' || candidateId ? 'AMBIGUOUS' : 'UNMATCHED';
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
    ...(stage&&stage!==c.stage?{stage,stageSource:'SYSTEM'}:{}),
    lastContactAt: last(c.lastContactAt), lastWhatsAppAt: last(c.lastWhatsAppAt),
    ...(inbound ? { firstReplyAt: first(c.firstReplyAt), lastInboundAt: last(c.lastInboundAt) } : { contactedAt: first(c.contactedAt), lastOutboundAt: last(c.lastOutboundAt) }),
  } });
  if(stage&&stage!==c.stage)await tx.stageHistory.create({data:{customerId,fromStage:c.stage,toStage:stage,changedBy:c.ownerId,note:'SYSTEM: 已入库 WhatsApp 消息事实'}});
  if(!inbound)await contactedFeedback(tx,customerId,at);
  await tx.customerIntelligence.upsert({ where: { customerId }, create: { customerId, productsJson: '[]', analysisPending: true }, update: { analysisPending: true } });
}
