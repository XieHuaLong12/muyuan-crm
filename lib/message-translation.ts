/**
 * Which chat messages get a Chinese line: foreign-language text with at least a couple of letters. Chinese,
 * emoji, numbers, "[IMAGE]" placeholders and a file's own name are left alone.
 */
const CJK = /[㐀-鿿豈-﫿]/g;
const LETTER = /\p{L}/gu;
const MEDIA_TYPES = new Set(['IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'DOCUMENT', 'FILE', 'STICKER']);
/** How many messages one automatic request translates (newest first); the rest follow on the next poll. */
export const TRANSLATE_BATCH = 10;

export function needsTranslation(message: { content: string; messageType?: string; fileName?: string | null }) {
  const text = message.content.trim();
  if (!text || /^\[[^\]]*\]$/.test(text)) return false;
  if (MEDIA_TYPES.has((message.messageType ?? '').toUpperCase()) && message.fileName && (text === message.fileName || text === `[文件] ${message.fileName}`)) return false;
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters < 2) return false;
  return (text.match(CJK)?.length ?? 0) / letters < 0.3;
}
