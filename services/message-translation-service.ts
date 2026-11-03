import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { TRANSLATE_BATCH, needsTranslation } from '@/lib/message-translation';
import { accessible } from './customer-service';

/**
 * Chinese for chat messages (消息页「自动翻译」). A customer's foreign-language messages are translated once and
 * stored (MessageTranslation MACHINE), so nobody translates the same message again; what a salesperson wrote in
 * Chinese before 译成客户语言 is stored with the message they sent (ORIGINAL).
 */

const NOT_CONFIGURED = '翻译暂不可用：需要配置 DeepSeek，或在线索导入的「翻译服务配置」中设置翻译服务';

/** Why DeepSeek did not answer, in words a salesperson can act on. */
function failureReason(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'DeepSeek 响应超时';
  const message = error instanceof Error ? error.message : '';
  return message.startsWith('DeepSeek') ? message : `DeepSeek 连接失败${message ? `（${message}）` : ''}`;
}

/**
 * Chinese through the translation service set up for lead imports, then DeepSeek. `error` says why there is none:
 * nothing is set up, or the service that is set up failed this time (timeout, balance, rate limit…), which a retry may fix.
 */
async function toChinese(text: string): Promise<{ text: string } | { error: string }> {
  const { translator } = await import('./meta-translation-service');
  const result = await (await translator()).translate(text.slice(0, 4000));
  if (!result.pending && result.text.trim()) return { text: result.text };
  const { translateToChinese } = await import('./sales-copilot-service');
  try {
    const translation = await translateToChinese(text);
    return translation ? { text: translation } : { error: NOT_CONFIGURED };
  } catch (error) {
    return { error: `翻译失败：${failureReason(error)}，请稍后点「重试」` };
  }
}

const translationSelect = { kind: true, text: true } as const;
/** Stored Chinese for a page of messages, by message id. */
export async function storedTranslations(messageIds: string[]) {
  if (!messageIds.length) return new Map<string, { kind: string; text: string }>();
  const rows = await db.messageTranslation.findMany({ where: { messageId: { in: messageIds } }, select: { messageId: true, ...translationSelect } });
  return new Map(rows.map(({ messageId, ...row }) => [messageId, row]));
}

async function store(messageId: string, kind: 'MACHINE' | 'ORIGINAL', text: string) {
  // Two people opening the same chat may translate the same message: the first stored one stays.
  return db.messageTranslation.upsert({ where: { messageId }, create: { messageId, kind, text: text.slice(0, 20_000) }, update: {}, select: translationSelect });
}

/** One message, when someone clicks 翻译 (auto-translate off) — stored like the automatic ones. */
export async function translateMessage(user: Actor, input: unknown) {
  const { messageId } = z.object({ messageId: z.string().trim().min(1).max(191) }).parse(input);
  const message = await db.whatsAppMessage.findUnique({ where: { id: messageId }, select: { customerId: true, content: true, translation: { select: translationSelect } } });
  if (!message) throw new HttpError(404, '消息不存在');
  await accessible(message.customerId, user);
  if (message.translation) return { text: message.translation.text, kind: message.translation.kind };
  if (!message.content.trim() || /^\[[^\]]*\]$/.test(message.content.trim())) throw new HttpError(400, '这条消息没有可翻译的文字');
  const result = await toChinese(message.content);
  if ('error' in result) throw new HttpError(503, result.error);
  const saved = await store(messageId, 'MACHINE', result.text);
  return { text: saved.text, kind: saved.kind };
}

const batchInput = z.object({ customerId: z.string().trim().min(1).max(191), messageIds: z.array(z.string().trim().min(1).max(191)).min(1).max(TRANSLATE_BATCH) });

/**
 * The chat's automatic translation: the newest untranslated foreign messages on screen, a few per request.
 * Messages that need nothing (Chinese, numbers, pictures) are skipped; `unavailable` says no translation service
 * answered, so the chat stops asking.
 */
export async function translateBatch(user: Actor, input: unknown) {
  const v = batchInput.parse(input);
  await accessible(v.customerId, user);
  const customer = await db.customer.findUniqueOrThrow({ where: { id: v.customerId }, select: { autoTranslate: true } });
  if (!customer.autoTranslate) throw new HttpError(409, '这位客户关掉了自动翻译');
  const messages = await db.whatsAppMessage.findMany({ where: { id: { in: v.messageIds }, customerId: v.customerId, translation: null },
    select: { id: true, content: true, messageType: true, fileName: true } });
  const translations: Record<string, { kind: string; text: string }> = {};
  let failed = 0;
  for (const message of messages.filter(needsTranslation)) {
    const result = await toChinese(message.content);
    if ('text' in result) translations[message.id] = await store(message.id, 'MACHINE', result.text);
    else failed++;
  }
  return { translations, unavailable: failed > 0 && !Object.keys(translations).length };
}

/** The chat header's 自动翻译 switch, per customer and shared by everyone who opens the chat. */
export async function setAutoTranslate(user: Actor, input: unknown) {
  const v = z.object({ customerId: z.string().trim().min(1).max(191), on: z.boolean() }).parse(input);
  await accessible(v.customerId, user);
  await db.customer.update({ where: { id: v.customerId }, data: { autoTranslate: v.on }, select: { id: true } });
  return { customerId: v.customerId, autoTranslate: v.on };
}

/** What the salesperson wrote in Chinese before 译成客户语言, kept with the message they sent. */
export async function keepOriginal(messageId: string, original: string) {
  if (original.trim()) await store(messageId, 'ORIGINAL', original.trim());
}
