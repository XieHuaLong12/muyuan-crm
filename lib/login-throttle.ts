/**
 * In-memory login throttle.
 *
 * Failures are counted per client address and per (email, address) pair, so a stranger cannot lock a
 * colleague out by mistyping their email on purpose, while one address cannot spray passwords across
 * many accounts either. A generous per-email ceiling slows distributed guessing on a single account.
 * Entries expire after the window and the map is bounded. State is per process: a restart or a second
 * instance starts with fresh counters, which only ever makes the throttle more lenient.
 */
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LIMITS = { pair: 8, address: 30, email: 50 } as const;
const MAX_ENTRIES = 10_000;

type Entry = { count: number; until: number };
const failures = new Map<string, Entry>();

function keys(email: string, address: string) {
  const normalized = email.trim().toLowerCase();
  return { pair: `pair:${normalized}|${address}`, address: `addr:${address}`, email: `email:${normalized}` };
}

function prune(now: number) {
  for (const [key, entry] of failures) if (entry.until <= now) failures.delete(key);
  // Still too many live entries: drop the oldest ones (Map keeps insertion order).
  while (failures.size > MAX_ENTRIES) failures.delete(failures.keys().next().value!);
}

function current(key: string, now: number) {
  const entry = failures.get(key);
  return entry && entry.until > now ? entry.count : 0;
}

/** Throws nothing; returns whether this attempt is allowed before checking the password. */
export function loginAllowed(email: string, address: string, now = Date.now()) {
  const k = keys(email, address);
  return current(k.pair, now) < LOGIN_LIMITS.pair && current(k.address, now) < LOGIN_LIMITS.address && current(k.email, now) < LOGIN_LIMITS.email;
}

export function recordLoginFailure(email: string, address: string, now = Date.now()) {
  if (failures.size > MAX_ENTRIES) prune(now);
  for (const key of Object.values(keys(email, address))) {
    failures.set(key, { count: current(key, now) + 1, until: now + LOGIN_WINDOW_MS });
  }
}

/** A successful login clears the pair counter; address and email counters age out on their own. */
export function recordLoginSuccess(email: string, address: string) {
  failures.delete(keys(email, address).pair);
}

export function resetLoginThrottle() {
  failures.clear();
}

/** First forwarded address when behind a proxy, otherwise the direct peer as reported by the platform. */
export function clientAddress(headers: Headers) {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}
