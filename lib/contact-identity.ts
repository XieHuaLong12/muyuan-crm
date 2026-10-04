import { createHash } from 'node:crypto';
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Never infer a country from the customer's sales market or a number suffix. */
export function canonicalPhone(value?: string | null, countryCode?: string | null, internationalDigits = false): string | null {
  if (!value) return null;
  const raw = value.trim().replace(/^p:/i, '').replace(/[\s().-]/g, '');
  if (!/^(?:\+|00)?\d+$/.test(raw)) return null;
  const code = countryCode?.toUpperCase();
  const country = code && isSupportedCountry(code) ? code as CountryCode : undefined;
  const input = raw.startsWith('00') ? `+${raw.slice(2)}` : raw.startsWith('+') || country ? raw : internationalDigits ? `+${raw}` : raw;
  const parsed = parsePhoneNumberFromString(input, country);
  return parsed?.isPossible() && !parsed.ext ? parsed.number : null;
}
export const canonicalEmail = (value?: string | null) => {
  const email = value?.trim().toLowerCase() || '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 191 ? email : null;
};
export const identityKey = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const metaLeadKey = (id: string) => `meta:${id.trim().replace(/^l:/i, '')}`;
export function sourceInstant(value?: string | null): Date | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) return null;
  const at = new Date(normalized);
  return Number.isNaN(at.getTime()) ? null : at;
}
