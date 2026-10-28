/**
 * Cold e-mail content (docs/CUSTOMER_RADAR_COLD_EMAIL.md §4.5, §7.1): template variables and checks, the footer every
 * mail carries, and the plain-text MIME message handed to Gmail. Pure functions, unit-tested.
 */

export const TEMPLATE_CODE = /^(FR|EN)-([1-3])-([A-Z0-9]{1,4})$/;
export const TEMPLATE_VARIABLES = ['称呼', '公司名', '城市', '个性化开头', '目录链接'] as const;
export const TEMPLATE_STATUSES = { TESTING: '测试中', WINNER: '胜出', RETIRED: '停用' } as const;
export const TEMPLATE_VARIANTS = { STANDARD: '标准', FAIR: '广交会邀请版' } as const;
/** Words per mail, without the signature and the unsubscribe line: short mails get answered. */
export const WORD_LIMITS = [120, 80, 50] as const;
export const MAX_LINKS = 2;

export type MailLanguage = 'fr' | 'en';
export const LANGUAGE_LABELS: Record<MailLanguage, string> = { fr: '法语', en: '英语' };
/** Every mail ends with a way out (Gmail's sender rules, GDPR); a reply "stop" is read as 退订 by the reply rules. */
export const UNSUBSCRIBE_LINE: Record<MailLanguage, string> = {
  fr: 'Si vous ne souhaitez plus recevoir nos e-mails, répondez simplement « stop ».',
  en: 'If you would rather not hear from us again, just reply "stop".',
};

export type TemplateValues = { greeting: string; company: string; city: string; opening: string; catalogUrl: string };
/** {称呼}: "Bonjour Jean," when the contact's name is known, otherwise "Bonjour," (Hello in English). */
export const greetingFor = (language: MailLanguage, name = '') => `${language === 'fr' ? 'Bonjour' : 'Hello'}${name.trim() ? ` ${name.trim()}` : ''},`;

/**
 * Fills a template. A line holding nothing but {个性化开头} disappears when there is no opening, so the mail reads as
 * the version without one instead of leaving a blank line.
 */
export function renderTemplate(text: string, values: TemplateValues) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(line => !(line.trim() === '{个性化开头}' && !values.opening.trim()));
  return lines.join('\n')
    .replaceAll('{称呼}', values.greeting).replaceAll('{公司名}', values.company).replaceAll('{城市}', values.city)
    .replaceAll('{个性化开头}', values.opening.trim()).replaceAll('{目录链接}', values.catalogUrl)
    .replace(/\n{3,}/g, '\n\n').trim();
}

const URL_RE = /https?:\/\/[^\s<>()]+/gi;
export const countWords = (text: string) => text.replace(/\{[^}]*\}/g, ' ').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;

/** What a template may not do (unknown variables, too many links, no subject on a first mail) and what it should not. */
export function checkTemplate(input: { step: number; subject: string; body: string }) {
  const errors: string[] = [], warnings: string[] = [];
  const unknown = [...new Set([...`${input.subject}\n${input.body}`.matchAll(/\{([^{}\n]{1,20})\}/g)].map(m => m[1]).filter(name => !(TEMPLATE_VARIABLES as readonly string[]).includes(name)))];
  if (unknown.length) errors.push(`不认识的变量：${unknown.map(v => `{${v}}`).join(' ')}。可用变量：${TEMPLATE_VARIABLES.map(v => `{${v}}`).join(' ')}`);
  if (input.step === 1 && !input.subject.trim()) errors.push('第 1 封必须写主题');
  const links = (input.body.match(URL_RE)?.length ?? 0) + (input.body.includes('{目录链接}') ? 1 : 0);
  if (links > MAX_LINKS) errors.push(`每封最多 ${MAX_LINKS} 个链接，现在有 ${links} 个`);
  const words = countWords(input.body);
  const limit = WORD_LIMITS[input.step - 1] ?? WORD_LIMITS[0];
  if (words > limit) warnings.push(`第 ${input.step} 封建议 ${limit} 词以内，现在约 ${words} 词`);
  if (input.step > 1 && input.body.includes('{个性化开头}')) warnings.push('个性化开头只在第 1 封使用，第 2、3 封里会是空的');
  if (input.step > 1 && input.subject.trim()) warnings.push('第 2、3 封在同一线程里回复，主题会用「Re: 第 1 封主题」，这里填写的主题不会用到');
  return { errors, warnings, words, links };
}

/** Body as sent: the template, then the mailbox signature, then the unsubscribe line. */
export const mailBody = (rendered: string, signature: string, language: MailLanguage) =>
  [rendered.trim(), signature.trim(), UNSUBSCRIBE_LINE[language]].filter(Boolean).join('\n\n');
export const replySubject = (subject: string) => /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;

// ─── MIME ────────────────────────────────────────────────

/** RFC 2047 encoded words for a header with non-ASCII text, each word short enough to fold. */
export function encodeHeader(value: string) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map(word => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** Quoted-printable (RFC 2045): mostly-ASCII text stays readable, accents become =C3=A9, lines stay under 76 characters. */
export function quotedPrintable(text: string) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const bytes = Buffer.from(line, 'utf8');
    const tokens: string[] = [];
    bytes.forEach((b, i) => {
      const plain = (b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && i < bytes.length - 1);
      tokens.push(plain ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`);
    });
    const out: string[] = [];
    let current = '';
    for (const token of tokens) {
      if (current.length + token.length > 75) { out.push(`${current}=`); current = ''; }
      current += token;
    }
    out.push(current);
    return out.join('\r\n');
  }).join('\r\n');
}

const displayName = (name: string) => /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '')}"` : encodeHeader(name);
const rfcDate = (date: Date) => date.toUTCString().replace('GMT', '+0000');

export type MailMessage = {
  from: { name: string; address: string }; to: string; subject: string; body: string;
  /** Message-IDs of the earlier mails of the thread, oldest first: In-Reply-To is the last, References all of them. */
  thread?: string[]; date?: Date;
};
/** A plain-text message: no HTML, no images, no tracking pixel, and a mailto unsubscribe header. */
export function buildMessage(m: MailMessage) {
  const thread = (m.thread ?? []).filter(Boolean);
  const headers = [
    `From: ${m.from.name ? `${displayName(m.from.name)} ` : ''}<${m.from.address}>`,
    `To: <${m.to}>`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${rfcDate(m.date ?? new Date())}`,
    ...(thread.length ? [`In-Reply-To: ${thread[thread.length - 1]}`, `References: ${thread.join(' ')}`] : []),
    `List-Unsubscribe: <mailto:${m.from.address}?subject=unsubscribe>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${quotedPrintable(m.body)}\r\n`;
}

/** The next free version of a template code: FR-1-A → FR-1-B (skipping taken ones), Z → Z2. */
export function nextTemplateCode(code: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const match = TEMPLATE_CODE.exec(code);
  if (!match) return code;
  const [, language, step] = match;
  const versions = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].concat(Array.from({ length: 98 }, (_, i) => `Z${i + 2}`));
  return versions.map(v => `${language}-${step}-${v}`).find(c => !used.has(c)) ?? code;
}
