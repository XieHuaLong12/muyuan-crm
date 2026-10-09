import { canonicalPhone } from '@/lib/contact-identity';
import { lockIdentity, resolveContact } from './contact-identity-service';
import { ensureConversation, messageFacts } from './conversation-identity-service';
import { retryTransaction } from '@/lib/transaction-retry';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { accessible } from '@/services/customer-service';
import { signedMediaUrl,mediaKind } from './whatsapp-media-service';
import { syncCustomerWorkflow } from './workflow-service';
import { normalizeWhatsApp } from '@/lib/whatsapp';
import { decryptWhatsAppAccessToken } from './whatsapp-connect-service';
import { gupshupSource } from '@/lib/gupshup';
import { customerServiceWindow, requireOpenWindow } from './whatsapp-window-service';
import { replayWhatsAppReceipts } from './whatsapp-webhook-service';

export const sendMessageSchema = z.object({ customerId: z.string().min(1).max(191),
  content: z.string().trim().max(4096).default(''), mediaAssetId: z.string().min(1).optional(), requestId: z.string().uuid() }).refine(v=>v.content.length>0||!!v.mediaAssetId,'请输入消息或选择附件');
export const messageSelect = { id: true, customerId: true, waMessageId: true, source: true, sourceMessageId: true, attachmentMetadata: true, content: true,
  mediaUrl: true, mimeType: true, fileName: true, sender: true, direction: true, messageType: true, status: true, sentAt: true, createdAt: true, updatedAt: true } as const;

const gupshupReady = () => !!(process.env.GUPSHUP_API_KEY?.trim() && gupshupSource() && process.env.GUPSHUP_APP_NAME?.trim());

export async function listWhatsAppMessages(customerId: string, user: Actor, before?: string) {
  const customer = await accessible(customerId, user);
  const cursor = before ? await db.whatsAppMessage.findFirst({ where: { id: before, customerId } }) : null;
  if (before && !cursor) throw new HttpError(400, '无效的聊天分页位置');
  const messages = await db.whatsAppMessage.findMany({ where: { customerId }, select: messageSelect,
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 51, ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}) });
  const integration = await db.whatsAppIntegration.findUnique({ where: { id: 'primary' },
    select: { status: true, phoneNumberId: true, encryptedAccessToken: true } });
  const hasMore = messages.length > 50;
  const page = messages.slice(0, 50);
  const metaReady = integration?.status === 'CONNECTED' && !!integration.phoneNumberId && !!integration.encryptedAccessToken;
  const window = await customerServiceWindow(customerId,user,gupshupReady()?undefined:{provider:'cloud_api',accountId:integration?.phoneNumberId||'NOT_CONNECTED'});
  return { messages: page.reverse(), nextCursor: hasMore ? page[0].id : null, stage: customer.stage,
    lastInboundAt: customer.lastInboundAt, configured: metaReady || gupshupReady(), ...window };
}

export async function sendWhatsAppMessage(input: unknown, user: Actor, origin?: string) {
  const { customerId, content, requestId, mediaAssetId } = sendMessageSchema.parse(input);
  const customer = await accessible(customerId, user);
  const asset = mediaAssetId ? await db.mediaAsset.findFirst({where:{id:mediaAssetId,customerId}}) : null;
  if(mediaAssetId && !asset)throw new HttpError(404,'附件不存在或不属于此客户');
  const mediaUrl=asset?`/api/whatsapp/media/${asset.id}`:null;
  const existing = await db.whatsAppMessage.findUnique({ where: { requestId } });
  if (existing) {
    if (existing.customerId !== customerId || existing.content !== content || existing.mediaUrl !== mediaUrl) throw new HttpError(409, '发送请求编号已使用');
    return { message: existing };
  }

  const integration = await db.whatsAppIntegration.findUnique({ where: { id: 'primary' } });
  let transport: 'META' | 'GUPSHUP';
  let source = '';
  let accessToken = '';
  let phoneNumberId = '';
  let gupshupApiKey = '';
  let gupshupAppName = '';

  if (!gupshupReady() && integration?.status === 'CONNECTED') {
    if (!integration.phoneNumberId || !integration.encryptedAccessToken) {
      throw new HttpError(503, 'Meta WhatsApp 连接信息不完整，请重新连接 WhatsApp');
    }
    if (integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() <= Date.now()) {
      throw new HttpError(503, 'WhatsApp 授权已过期，请重新连接 WhatsApp');
    }
    try {
      accessToken = decryptWhatsAppAccessToken(integration.encryptedAccessToken);
    } catch {
      throw new HttpError(503, 'WhatsApp Access Token 无法解密，请重新连接 WhatsApp');
    }
    if (!accessToken) throw new HttpError(503, 'WhatsApp Access Token 为空，请重新连接 WhatsApp');
    transport = 'META';
    phoneNumberId = integration.phoneNumberId;
    source = normalizeWhatsApp(integration.displayPhoneNumber) || phoneNumberId;
  } else {
    gupshupApiKey = process.env.GUPSHUP_API_KEY?.trim() || '';
    source = normalizeWhatsApp(gupshupSource());
    gupshupAppName = process.env.GUPSHUP_APP_NAME?.trim() || '';
    if (!gupshupApiKey || !source || !gupshupAppName) throw new HttpError(503, 'Meta WhatsApp 尚未连接，且未配置 Gupshup 发送服务');
    transport = 'GUPSHUP';
  }

  const destination = normalizeWhatsApp(customer.waId || customer.whatsapp || customer.phone);
  if (!/^[1-9]\d{6,14}$/.test(destination)) throw new HttpError(400, '客户 WhatsApp 号码需要有效国家码');
  const identity=await resolveContact({phones:[canonicalPhone(destination,undefined,true)!].filter(Boolean)});
  const provider=transport==='META'?'cloud_api':'gupshup', providerAccountId=transport==='META'?phoneNumberId:gupshupSource()!;
  const manual=await db.whatsAppContact.findFirst({where:{provider,accountId:providerAccountId,phoneE164:canonicalPhone(destination,undefined,true),status:'MANUAL',customerId}});
  if(!manual&&(identity.status!=='MATCHED'||identity.customerId!==customerId))throw new HttpError(409,'此号码身份不明确，请先人工认领后发送');
  await requireOpenWindow(customerId,user,{provider,accountId:providerAccountId});
  if(customer.whatsappOptInStatus==='OPTED_OUT')throw new HttpError(409,'客户已明确退订，请先人工核对后续沟通许可');
  const mediaOrigin=process.env.PUBLIC_APP_URL?.replace(/\/$/,'')||origin;
  if(asset && !mediaOrigin)throw new HttpError(503,'附件发送需要可访问的应用地址');
  const kind=asset?mediaKind(asset.mimeType):'text';
  if(kind==='audio'&&content)throw new HttpError(400,'语音附件不支持附带文字，请先清空输入框，文字可单独发送');

  let message;
  try {
    message = await db.whatsAppMessage.create({ data: { customerId, requestId, waId: destination, source: provider,providerAccountId,
      sourcePhone:canonicalPhone(source,undefined,true),destinationPhone:canonicalPhone(destination,undefined,true),
      direction: 'OUTBOUND', sender: source, content, mediaUrl, mimeType:asset?.mimeType, fileName:asset?.fileName, messageType: kind.toUpperCase(), status: 'PENDING', sentAt: new Date(), raw: '{}' } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await db.whatsAppMessage.findUniqueOrThrow({ where: { requestId } });
      if (duplicate.customerId !== customerId || duplicate.content !== content || duplicate.mediaUrl !== mediaUrl) throw new HttpError(409, '发送请求编号已使用');
      return { message: duplicate };
    }
    throw error;
  }

  let providerMessageId = '';
  try {
    if (transport === 'META') {
      const graphVersion = process.env.META_GRAPH_VERSION?.trim() || 'v26.0';
      const endpoint = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
      let outbound: Record<string, unknown>;
      if (!asset) {
        outbound = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destination,
          type: 'text',
          text: { body: content },
        };
      } else {
        const link = signedMediaUrl(asset.id, mediaOrigin!);
        const metaType = kind === 'file' ? 'document' : kind;
        const media: Record<string, unknown> = { link };
        if (metaType === 'document' && asset.fileName) media.filename = asset.fileName;
        if (metaType !== 'audio' && content) media.caption = content;
        outbound = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destination,
          type: metaType,
          [metaType]: media,
        };
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(outbound),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => ({})) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string; code?: number; error_subcode?: number };
      };
      providerMessageId = body.messages?.[0]?.id || '';
      if (!response.ok || !providerMessageId) {
        const code = body.error?.code ? ` [${body.error.code}]` : '';
        const detail = body.error?.message || 'Meta WhatsApp 未接受此消息';
        return { message: await db.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'FAILED' } }),
          error: `发送失败${code}：${detail}` };
      }
    } else {
      const response = await fetch('https://api.gupshup.io/wa/api/v1/msg', { method: 'POST',
        headers: { apikey: gupshupApiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ channel: 'whatsapp', source, destination, 'src.name': gupshupAppName,
          message: JSON.stringify(asset ? (kind==='image'?{type:kind,originalUrl:signedMediaUrl(asset.id,mediaOrigin!),previewUrl:signedMediaUrl(asset.id,mediaOrigin!),caption:content}:{type:kind,url:signedMediaUrl(asset.id,mediaOrigin!),...(kind==='file'?{filename:asset.fileName}:{}),...(kind!=='audio'?{caption:content}:{})}):{type:'text',text:content}) }),
        signal: AbortSignal.timeout(20_000) });
      const body = await response.json().catch(() => ({})) as { status?: string; messageId?: string };
      if (!response.ok || body.status !== 'submitted' || typeof body.messageId !== 'string' || !body.messageId) {
        return { message: await db.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'FAILED' } }),
          error: 'Gupshup 未接受此消息，请检查账号、号码与会话窗口。' };
      }
      providerMessageId = body.messageId;
    }
  } catch {
    // A timeout cannot prove rejection: keep a durable record and never auto-resend.
    return { message: await db.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'UNKNOWN' } }),
      error: '发送结果未知，请核对 WhatsApp 后再操作；系统不会自动重复发送。' };
  }

  const sentAt = new Date();
  // Keep persistence outside the network catch: a DB failure must not label an accepted message FAILED.
  const saved = await retryTransaction(()=>db.$transaction(async tx => {
    await lockIdentity(tx);
    const linked=await ensureConversation(tx,{provider,accountId:providerAccountId,peerId:canonicalPhone(destination,undefined,true)||destination,phone:destination,externalId:destination,sentAt,direction:'OUTBOUND',sourceMessageId:providerMessageId});
    if(linked.customerId!==customerId)await tx.identityAudit.create({data:{entityType:'OUTBOUND_MESSAGE',entityId:message.id,fromCustomerId:customerId,toCustomerId:linked.customerId,actorId:user.id,reason:'供应商已接受消息，期间身份发生变化；保存发送凭证，需人工核对'}});
    const saved = await tx.whatsAppMessage.update({ where: { id: message.id },
      data: { conversationId:linked.conversation.id, status: 'ENQUEUED', providerMessageId, waMessageId: providerMessageId, sentAt } });
    await tx.customer.updateMany({ where: { id: customerId, OR: [{ lastContactAt: null }, { lastContactAt: { lt: sentAt } }] }, data: { lastContactAt: sentAt } });
    await tx.customer.updateMany({ where: { id: customerId, OR: [{ lastWhatsAppAt: null }, { lastWhatsAppAt: { lt: sentAt } }] }, data: { lastWhatsAppAt: sentAt } });
    await tx.customer.updateMany({ where: { id: customerId, OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: sentAt } }] }, data: { lastOutboundAt: sentAt } });
    await messageFacts(tx,customerId,sentAt,'OUTBOUND');
    await (await import('./workflow-service')).recordFirstContact(tx,customerId,sentAt,user.id);
    return saved;
  }));
  await replayWhatsAppReceipts(provider,providerAccountId,providerMessageId);
  await syncCustomerWorkflow(customerId);
  return { message: await db.whatsAppMessage.findUniqueOrThrow({where:{id:saved.id}}) };
}
