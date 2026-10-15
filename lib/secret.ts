import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Only node built-ins here: webhook and cron routes import this at the top level, where loading Prisma or a
// service would break responses that need no database (see app/api/leads/webhook/route.ts).

/** Constant-time comparison, so response timing does not reveal how much of a secret or signature matched. */
export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a, 'utf8'), right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Scheduled jobs authenticate with the header x-cron-secret = META_SYNC_SECRET. */
export function cronSecretValid(supplied: string | null | undefined) {
  const expected = process.env.META_SYNC_SECRET?.trim() || '';
  return !!expected && !!supplied && safeEqual(supplied, expected);
}

const sealKey = () => {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET 未配置');
  return createHash('sha256').update(process.env.AUTH_SECRET).digest();
};

/** Encrypts a credential for the database (AES-256-GCM, key from AUTH_SECRET): "iv.tag.data" in base64. */
export function sealSecret(value: string) {
  if (!value) return '';
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', sealKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64')).join('.');
}

/** Reads a credential sealed by sealSecret; throws when it was sealed with another AUTH_SECRET or is damaged. */
export function openSecret(value: string) {
  if (!value) return '';
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('密文格式无效');
  const [iv, tag, data] = parts.map(part => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', sealKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
