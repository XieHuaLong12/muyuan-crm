import { createHmac } from 'node:crypto';
import { safeEqual } from './secret';

export function createSession(id: string, version: number, secret: string, now = Date.now()) {
  const value = `${id}.${now + 7 * 86400000}.${version}`;
  return `${value}.${createHmac('sha256', secret).update(value).digest('hex')}`;
}

export function parseSession(raw: string, secret: string, now = Date.now()) {
  const parts = raw.split('.');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [id, expiry] = parts;
  const version = parts.length === 4 ? Number(parts[2]) : 0;
  if (!id || !Number.isSafeInteger(Number(expiry)) || Number(expiry) <= now || !Number.isSafeInteger(version) || version < 0) return null;
  const signature = parts.at(-1)!;
  const expected = createHmac('sha256', secret).update(parts.slice(0, -1).join('.')).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(signature) || !safeEqual(signature, expected)) return null;
  return { id, version };
}
