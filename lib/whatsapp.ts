/**
 * Normalize a phone/WhatsApp identifier for matching inside the CRM.
 *
 * Examples:
 * +966 50 123 4567   -> 966501234567
 * 00966-50-123-4567 -> 966501234567
 *
 * This intentionally does not guess a missing country code. The CRM should
 * preserve the original user-entered value in Customer.whatsapp and use this
 * normalized value only as a stable matching key.
 */
export function normalizeWhatsApp(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '').replace(/^00/, '');
}
