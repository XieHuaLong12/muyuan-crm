import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { canonicalPhone } from './contact-identity';

// Everyday short names where the standard Chinese region name is long or formal (印度尼西亚 → 印尼).
const SHORT_NAMES: Record<string, string> = {
  ID: '印尼', SA: '沙特', AE: '阿联酋', HK: '中国香港', MO: '中国澳门', TW: '中国台湾', PS: '巴勒斯坦', BA: '波黑', DO: '多米尼加',
};
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

/** Chinese name of an ISO country code, as customers' country is written elsewhere in the CRM (法国, 墨西哥, 印尼). */
export function countryName(code: string) {
  return SHORT_NAMES[code] ?? regionNames.of(code) ?? code;
}

type Numbers = { whatsapp?: string | null; waId?: string | null; phone?: string | null };

/**
 * The country a customer's number belongs to, from its calling code: +86 is China, +33 France, +1 the US or
 * Canada by area code. WhatsApp numbers always carry the calling code; a phone number only counts when written
 * internationally (+ or 00), because a national number says nothing about the country.
 */
export function phoneCountry(numbers: Numbers): { code: string; name: string } | null {
  const candidates = [canonicalPhone(numbers.whatsapp, undefined, true), canonicalPhone(numbers.waId, undefined, true), canonicalPhone(numbers.phone)];
  for (const number of candidates) {
    const code = number ? parsePhoneNumberFromString(number)?.country : undefined;
    if (code) return { code, name: countryName(code) };
  }
  return null;
}

/**
 * Fills a blank country from the customer's WhatsApp or international phone number. A country someone already
 * entered is never replaced. Only the visible country changes: countryCode also decides how a national phone
 * number is matched against other customers, so it stays as entered.
 */
export function withPhoneCountry<T extends Numbers & { country?: string | null }>(data: T): T {
  if (data.country?.trim()) return data;
  const detected = phoneCountry(data);
  return detected ? { ...data, country: detected.name } : data;
}

export type ContactNumber = { kind: 'WHATSAPP' | 'PHONE'; display: string; copy: string; chat: string | null };

/**
 * The number to follow a customer up on WhatsApp: the WhatsApp number, else the phone number (ad forms usually
 * only ask for a phone, which is the WhatsApp number in practice). `copy` is the plain international number, which
 * WhatsApp's search and "new chat" accept; `chat` opens the conversation directly.
 */
export function contactNumber(c: Numbers & { countryCode?: string | null }): ContactNumber | null {
  const whatsapp = canonicalPhone(c.whatsapp, undefined, true) ?? canonicalPhone(c.waId, undefined, true);
  const phone = whatsapp ? null : canonicalPhone(c.phone, c.countryCode);
  const number = whatsapp ?? phone;
  if (number) {
    return { kind: whatsapp ? 'WHATSAPP' : 'PHONE', display: parsePhoneNumberFromString(number)?.formatInternational() ?? number, copy: number, chat: `https://wa.me/${number.slice(1)}` };
  }
  // Not a recognisable international number: still show and copy exactly what was entered.
  const raw = c.whatsapp?.trim() || c.phone?.trim();
  return raw ? { kind: c.whatsapp?.trim() ? 'WHATSAPP' : 'PHONE', display: raw, copy: raw, chat: null } : null;
}
