import type { GmailMessage, GmailPart } from './gmail';

/**
 * Reading what comes back to a sending mailbox (docs/CUSTOMER_RADAR_COLD_EMAIL.md §7.2): the message as text, the
 * reply without the quoted mail below it, and the rule pre-screen — bounces and auto-replies are handled by rules,
 * without the AI. Pure functions, unit-tested with real-world samples.
 */

export const REPLY_CATEGORIES = {
  QUOTE: '要报价 / 要样品', INTERESTED: '有兴趣 / 要资料', QUESTION: '业务提问', REFERRAL: '转介绍',
  NOT_INTERESTED: '不感兴趣', UNSUBSCRIBE: '退订', AUTO_REPLY: '自动回复', BOUNCE: '退信', UNRELATED: '无关或推销', UNCLEAR: '无法判断',
} as const;
export type ReplyCategory = keyof typeof REPLY_CATEGORIES;
export const VALID_CATEGORIES: readonly ReplyCategory[] = ['QUOTE', 'INTERESTED', 'QUESTION', 'REFERRAL'];
export const isValidCategory = (category: string) => (VALID_CATEGORIES as readonly string[]).includes(category);
export const INTENTS = { HIGH: '高', MEDIUM: '中', LOW: '低' } as const;

const decode = (data?: string) => data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
/** HTML as readable text: line breaks kept, tags and entities gone. */
export function htmlToText(html: string) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|blockquote)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export type ParsedMail = {
  id: string; threadId: string; from: string; fromName: string; to: string; subject: string; date: Date | null; messageId: string;
  inReplyTo: string; references: string[]; headers: Record<string, string>; text: string; report: string; attachedHeaders: string;
};
const flatten = (part: GmailPart | undefined): GmailPart[] => part ? [part, ...(part.parts ?? []).flatMap(flatten)] : [];
const address = (value: string) => {
  const match = /<([^>]+)>/.exec(value) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(value);
  return (match?.[1] ?? '').trim().toLowerCase();
};
const ids = (value: string) => value.match(/<[^<>\s]+>/g) ?? [];

/** A Gmail message (format=full) as headers and text: the plain-text part, else the HTML as text; delivery reports apart. */
export function readGmailMessage(message: GmailMessage): ParsedMail {
  const headers: Record<string, string> = {};
  for (const h of message.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
  const parts = flatten(message.payload);
  const plain = parts.filter(p => p.mimeType === 'text/plain' && !p.filename).map(p => decode(p.body?.data)).join('\n');
  const html = parts.filter(p => p.mimeType === 'text/html' && !p.filename).map(p => decode(p.body?.data)).join('\n');
  const report = parts.filter(p => p.mimeType === 'message/delivery-status').map(p => decode(p.body?.data)).join('\n');
  const attachedHeaders = parts.filter(p => p.mimeType === 'text/rfc822-headers' || p.mimeType === 'message/rfc822')
    .map(p => decode(p.body?.data) || (p.headers ?? []).map(h => `${h.name}: ${h.value}`).join('\n')).join('\n');
  const from = headers.from ?? '';
  const date = headers.date ? new Date(headers.date) : message.internalDate ? new Date(Number(message.internalDate)) : null;
  return {
    id: message.id, threadId: message.threadId, from: address(from), fromName: from.replace(/<[^>]*>/, '').replace(/"/g, '').trim(), to: address(headers.to ?? ''),
    subject: headers.subject ?? '', date: date && !Number.isNaN(date.getTime()) ? date : null, messageId: headers['message-id'] ?? '',
    inReplyTo: ids(headers['in-reply-to'] ?? '')[0] ?? '', references: ids(headers.references ?? ''), headers,
    text: (plain.trim() || htmlToText(html)).replace(/\r\n/g, '\n'), report, attachedHeaders,
  };
}

/**
 * The reply without the mail it quotes: everything from the first "On … wrote:" / "Le … a écrit :" / Outlook header
 * block / "-----Original Message-----", and lines starting with ">", is dropped.
 */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // "écrit" alone too: Gmail wraps a long French attribution as "… a" / "écrit :".
  const attribution = /(wrote|écrit|schrieb|escribió)\s*:?\s*$/i;
  const cut = lines.findIndex((line, i) => {
    const l = line.trim(), next = lines[i + 1]?.trim() ?? '';
    if (/^-{2,}\s*(original message|message d'origine|message original|forwarded message|message transféré)\s*-{2,}/i.test(l) || /^_{10,}$/.test(l)) return true;
    // "On Tue, 28 Oct 2026 at 10:00, Jason <j@x> wrote:" / "Le mer. 28 oct. 2026 à 10:00, Jason a écrit :", sometimes over two lines.
    if (/^(on|le|am|el)\s/i.test(l) && (attribution.test(l) || attribution.test(next))) return true;
    // Outlook: "From: …" directly followed by "Sent: …" or "Date: …".
    return /^(from|de|von)\s*:/i.test(l) && /^(sent|envoyé|date|gesendet|to|à)\s*:/i.test(next);
  });
  return (cut >= 0 ? lines.slice(0, cut) : lines).filter(line => !line.trimStart().startsWith('>')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export type Screen = { screen: 'HARD_BOUNCE' | 'SOFT_BOUNCE' | 'AUTO_REPLY' | 'NONE'; recipient: string; detail: string; originalMessageId: string };
const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const AUTO_SUBJECT = /^(automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office|ooo\b|réponse automatique|r[ée]ponse auto|abwesenheitsnotiz|respuesta autom[aá]tica|risposta automatica|رد تلقائي|خارج المكتب)/i;
// "Absence : …", "Absent jusqu'au …" — but not an ordinary subject that starts with the word ("Absence de catalogue ?").
const ABSENCE_SUBJECT = /^absen(ce|t|te)\s*(:|du\b|until\b|jusqu|from\b|$)/i;
/**
 * The rule pre-screen. A delivery report (from a mailer daemon, or a delivery-status part) is a bounce: permanent for
 * a 5.x.x status, temporary for 4.x.x. A message marked as automatic (Auto-Submitted, X-Autoreply…) or with an
 * out-of-office subject is an auto-reply. Everything else goes to the AI.
 */
export function screenMessage(mail: ParsedMail): Screen {
  const h = mail.headers;
  const reportish = BOUNCE_SENDER.test(mail.from) || !!mail.report || /multipart\/report/i.test(h['content-type'] ?? '')
    || /^(delivery status notification|undeliverable|undelivered mail|mail delivery (failed|failure)|returned mail|non remis|non-remise|échec de la remise)/i.test(mail.subject);
  if (reportish) {
    const source = `${mail.report}\n${mail.text}`;
    const status = /Status:\s*([245])\.\d{1,3}\.\d{1,3}/i.exec(source)?.[1] ?? /\b([45])\d\d[ -]([45])\.\d\.\d+/.exec(source)?.[2] ?? (/\b(550|551|552|553|554)\b/.test(source) ? '5' : /\b(421|450|451|452)\b/.test(source) ? '4' : '');
    const recipient = (h['x-failed-recipients'] ?? /Final-Recipient:\s*rfc822;\s*([^\s]+)/i.exec(source)?.[1] ?? /Original-Recipient:\s*rfc822;\s*([^\s]+)/i.exec(source)?.[1] ?? '').trim().toLowerCase();
    const original = /^Message-ID:\s*(<[^>]+>)/im.exec(mail.attachedHeaders)?.[1] ?? '';
    const temporary = status === '4' || (status !== '5' && /\b(delay|delayed|retard|will retry|réessay)/i.test(mail.subject + source));
    return { screen: temporary ? 'SOFT_BOUNCE' : 'HARD_BOUNCE', recipient, detail: (/Diagnostic-Code:\s*(.+)/i.exec(source)?.[1] ?? source.slice(0, 200)).trim().slice(0, 200), originalMessageId: original };
  }
  const marked = (!!h['auto-submitted'] && h['auto-submitted'].toLowerCase() !== 'no') || 'x-autoreply' in h || 'x-autorespond' in h || 'x-autoresponder' in h
    || /auto_reply|auto-reply/i.test(h.precedence ?? '');
  const subject = mail.subject.replace(/^(re|tr|fw|fwd)\s*:\s*/i, '');
  const auto = marked || AUTO_SUBJECT.test(subject) || ABSENCE_SUBJECT.test(subject);
  return { screen: auto ? 'AUTO_REPLY' : 'NONE', recipient: '', detail: '', originalMessageId: '' };
}

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2, mar: 3, mars: 3, march: 3, apr: 4, avr: 4, avril: 4, april: 4,
  may: 5, mai: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7, aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, septembre: 9, september: 9,
  oct: 10, octobre: 10, october: 10, nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12,
};
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
/**
 * The day the person is back, read from an out-of-office text ("absent jusqu'au 4 novembre", "back on 04/11/2026",
 * "from 28/10 to 3/11"): the latest date within 90 days after the message. Day-first, as in France, the Gulf and
 * Australia. Null when no date is found.
 */
export function returnDateFrom(text: string, received: Date): Date | null {
  const t = fold(text);
  const year = received.getUTCFullYear();
  const found: Date[] = [];
  const add = (d: number, m: number, y?: number) => {
    if (d < 1 || d > 31 || m < 1 || m > 12) return;
    const full = y === undefined ? year : y < 100 ? 2000 + y : y;
    let date = new Date(Date.UTC(full, m - 1, d));
    if (y === undefined && date < new Date(received.getTime() - 86_400_000)) date = new Date(Date.UTC(full + 1, m - 1, d));
    if (date.getUTCMonth() === m - 1) found.push(date);
  };
  for (const m of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(Number(m[3]), Number(m[2]), Number(m[1]));
  for (const m of t.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g)) add(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
  for (const m of t.matchAll(/\b(\d{1,2})(?:er|st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?\b/g)) if (MONTHS[m[2]]) add(Number(m[1]), MONTHS[m[2]], m[3] ? Number(m[3]) : undefined);
  for (const m of t.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/g)) if (MONTHS[m[1]]) add(Number(m[2]), MONTHS[m[1]], m[3] ? Number(m[3]) : undefined);
  const limit = received.getTime() + 90 * 86_400_000;
  const ahead = found.filter(d => d.getTime() >= received.getTime() - 86_400_000 && d.getTime() <= limit);
  return ahead.length ? ahead.reduce((a, b) => (b > a ? b : a)) : null;
}

/** The thread link that opens the conversation in the sending mailbox (the salesperson must have access to it). */
export const threadLink = (mailbox: string, threadId: string) => `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#all/${threadId}`;
