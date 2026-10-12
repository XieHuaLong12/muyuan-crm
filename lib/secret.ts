import { timingSafeEqual } from 'node:crypto';

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
