import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { accessible } from '@/services/customer-service';
import { normalizeWhatsApp } from '@/lib/whatsapp';

export const sendMessageSchema = z.object({ customerId: z.string().min(1).max(191),
  content: z.string().trim().min(1).max(4096), requestId: z.string().uuid() });
export const messageSelect = { id: true, customerId: true, waMessageId: true, content: true,
  sender: true, direction: true, messageType: true, status: true, sentAt: true, createdAt: true, updatedAt: true } as const;

export async function listWhatsAppMessages(customerId: string, user: Actor, before?: string) {
  const customer = await accessible(customerId, user);
  const cursor = before ? await db.whatsAppMessage.findFirst({ where: { id: before, customerId } }) : null;
  if (before && !cursor) throw new HttpError(400, '无效的聊天分页位置');
  const messages = await db.whatsAppMessage.findMany({ where: { customerId }, select: messageSelect,
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 51, ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}) });
  const hasMore = messages.length > 50;
  const page = messages.slice(0, 50);
  return { messages: page.reverse(), nextCursor: hasMore ? page[0].id : null, stage: customer.stage,
    lastInboundAt: customer.lastInboundAt, configured: !!(process.env.GUPSHUP_API_KEY && process.env.GUPSHUP_SOURCE && process.env.GUPSHUP_APP_NAME) };
}

export async function sendWhatsAppMessage(input: unknown, user: Actor) {
  const { customerId, content, requestId } = sendMessageSchema.parse(input);
  const customer = await accessible(customerId, user);
  const existing = await db.whatsAppMessage.findUnique({ where: { requestId } });
  if (existing) {
    if (existing.customerId !== customerId || existing.content !== content) throw new HttpError(409, '发送请求编号已使用');
    return { message: existing };
  }
  const apiKey = process.env.GUPSHUP_API_KEY?.trim();
  const source = normalizeWhatsApp(process.env.GUPSHUP_SOURCE);
  const appName = process.env.GUPSHUP_APP_NAME?.trim();
  if (!apiKey || !source || !appName) throw new HttpError(503, '尚未配置 Gupshup 发送服务');
  const destination = normalizeWhatsApp(customer.waId || customer.whatsapp || customer.phone);
  if (!/^[1-9]\d{6,14}$/.test(destination)) throw new HttpError(400, '客户 WhatsApp 号码需要有效国家码');
  if (!customer.lastInboundAt || Date.now() - customer.lastInboundAt.getTime() > 24 * 60 * 60 * 1000) {
    throw new HttpError(409, '客户的 24 小时会话窗口已关闭，请等待客户回复或使用已审核模板开启会话');
  }
  let message;
  try {
    message = await db.whatsAppMessage.create({ data: { customerId, requestId, waId: destination,
      direction: 'OUTBOUND', sender: source, content, messageType: 'TEXT', status: 'PENDING', sentAt: new Date(), raw: '{}' } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await db.whatsAppMessage.findUniqueOrThrow({ where: { requestId } });
      if (duplicate.customerId !== customerId || duplicate.content !== content) throw new HttpError(409, '发送请求编号已使用');
      return { message: duplicate };
    }
    throw error;
  }
  let response: Response;
  let body: { status?: string; messageId?: string };
  try {
    response = await fetch('https://api.gupshup.io/wa/api/v1/msg', { method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ channel: 'whatsapp', source, destination, 'src.name': appName,
        message: JSON.stringify({ type: 'text', text: content }) }), signal: AbortSignal.timeout(20_000) });
    body = await response.json();
  } catch {
    // A timeout cannot prove rejection: keep a durable record and never auto-resend.
    return { message: await db.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'UNKNOWN' } }),
      error: '发送结果未知，请核对 WhatsApp 后再操作；系统不会自动重复发送。' };
  }
  if (!response.ok || body.status !== 'submitted' || typeof body.messageId !== 'string' || !body.messageId) {
    return { message: await db.whatsAppMessage.update({ where: { id: message.id }, data: { status: 'FAILED' } }),
      error: 'Gupshup 未接受此消息，请检查账号、号码与会话窗口。' };
  }
  const sentAt = new Date();
  // Keep persistence outside the network catch: a DB failure must not label an accepted message FAILED.
  const saved = await db.$transaction(async tx => {
    const saved = await tx.whatsAppMessage.update({ where: { id: message.id },
      data: { status: 'SENT', providerMessageId: body.messageId, waMessageId: body.messageId, sentAt } });
    await tx.customer.updateMany({ where: { id: customerId, OR: [{ lastContactAt: null }, { lastContactAt: { lt: sentAt } }] }, data: { lastContactAt: sentAt } });
    await tx.customer.updateMany({ where: { id: customerId, OR: [{ lastWhatsAppAt: null }, { lastWhatsAppAt: { lt: sentAt } }] }, data: { lastWhatsAppAt: sentAt } });
    await tx.customer.updateMany({ where: { id: customerId, OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: sentAt } }] }, data: { lastOutboundAt: sentAt } });
    return saved;
  });
  return { message: saved };
}
