import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/auth';
import { graphVersion } from '@/lib/meta-graph';

const graphBase = () => `https://graph.facebook.com/${graphVersion()}`;

const encryptionKey = () => {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET 未配置');
  return createHash('sha256').update(process.env.AUTH_SECRET).digest();
};

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

export function decryptWhatsAppAccessToken(value: string) {
  if (!value) return '';
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('WhatsApp access token 格式无效');
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export type WhatsAppConnectionStatus = {
  configured: boolean;
  missing: string[];
  appId: string;
  configurationId: string;
  graphVersion: string;
  webhookUrl: string;
  connection: {
    status: string;
    connectionMode: string;
    businessId: string;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string;
    tokenExpiresAt: string | null;
    subscribedAt: string | null;
    connectedAt: string | null;
    lastVerifiedAt: string | null;
    lastError: string;
  } | null;
};

export async function whatsappConnectionStatus(): Promise<WhatsAppConnectionStatus> {
  const required: Array<[string, string | undefined]> = [
    ['META_APP_ID', process.env.META_APP_ID],
    ['META_APP_SECRET', process.env.META_APP_SECRET],
    ['META_EMBEDDED_SIGNUP_CONFIG_ID', process.env.META_EMBEDDED_SIGNUP_CONFIG_ID],
    ['WHATSAPP_VERIFY_TOKEN', process.env.WHATSAPP_VERIFY_TOKEN],
  ];
  const missing = required.filter(([, value]) => !value?.trim()).map(([name]) => name);
  const row = await db.whatsAppIntegration.findUnique({ where: { id: 'primary' } });
  return {
    configured: missing.length === 0,
    missing,
    appId: process.env.META_APP_ID?.trim() || '',
    configurationId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() || '',
    graphVersion: graphVersion(),
    webhookUrl: 'https://avenlee.online/api/whatsapp/webhook',
    connection: row
      ? {
          status: row.status,
          connectionMode: row.connectionMode,
          businessId: row.businessId,
          wabaId: row.wabaId,
          phoneNumberId: row.phoneNumberId,
          displayPhoneNumber: row.displayPhoneNumber,
          verifiedName: row.verifiedName,
          tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
          subscribedAt: row.subscribedAt?.toISOString() ?? null,
          connectedAt: row.connectedAt?.toISOString() ?? null,
          lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
          lastError: row.lastError,
        }
      : null,
  };
}

const connectInput = z.object({
  code: z.string().trim().min(10).max(4096),
  wabaId: z.string().regex(/^\d+$/, 'WABA ID 无效'),
  phoneNumberId: z.string().regex(/^\d+$/, 'Phone Number ID 无效').optional(),
  businessId: z.string().regex(/^\d+$/).optional().default(''),
});

async function exchangeCode(code: string) {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new HttpError(503, 'Meta App ID / App Secret 尚未配置');
  const url = new URL(`${graphBase()}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof body.access_token !== 'string') {
    const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : null;
    throw new HttpError(502, typeof error?.message === 'string' ? `Meta 授权失败：${error.message}` : 'Meta 授权失败');
  }
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : null,
  };
}

async function subscribeWaba(wabaId: string, accessToken: string) {
  const response = await fetch(`${graphBase()}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body.success !== true) {
    const error = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : null;
    throw new HttpError(502, typeof error?.message === 'string' ? `Webhook 订阅失败：${error.message}` : 'Webhook 订阅失败');
  }
}

type PhoneMetadata = { id: string; displayPhoneNumber: string; verifiedName: string };

async function phoneMetadata(phoneNumberId: string, accessToken: string): Promise<PhoneMetadata> {
  const url = new URL(`${graphBase()}/${phoneNumberId}`);
  url.searchParams.set('fields', 'display_phone_number,verified_name');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) return { id: phoneNumberId, displayPhoneNumber: '', verifiedName: '' };
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    id: phoneNumberId,
    displayPhoneNumber: typeof body.display_phone_number === 'string' ? body.display_phone_number : '',
    verifiedName: typeof body.verified_name === 'string' ? body.verified_name : '',
  };
}

async function discoverPhoneNumber(wabaId: string, accessToken: string): Promise<PhoneMetadata> {
  const url = new URL(`${graphBase()}/${wabaId}/phone_numbers`);
  url.searchParams.set('fields', 'id,display_phone_number,verified_name');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  const body = (await response.json().catch(() => ({}))) as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
  if (!response.ok) throw new HttpError(502, body.error?.message ? `无法读取 WABA 电话号码：${body.error.message}` : '无法读取 WABA 电话号码');
  const rows = (body.data ?? []).map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    displayPhoneNumber: typeof row.display_phone_number === 'string' ? row.display_phone_number : '',
    verifiedName: typeof row.verified_name === 'string' ? row.verified_name : '',
  })).filter((row) => row.id);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new HttpError(409, 'Meta 没有返回可用的 WhatsApp 电话号码');
  throw new HttpError(409, `这个 WABA 有 ${rows.length} 个电话号码。请在 Hostinger 设置 WHATSAPP_PREFERRED_PHONE_NUMBER_ID 后重试。`);
}

export async function completeWhatsAppEmbeddedSignup(input: unknown) {
  const value = connectInput.parse(input);
  if (!process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim()) throw new HttpError(503, 'Embedded Signup Configuration ID 尚未配置');
  const configuredPhoneId = process.env.WHATSAPP_PREFERRED_PHONE_NUMBER_ID?.trim();
  const initialPhoneId = value.phoneNumberId || configuredPhoneId || '';
  const now = new Date();
  await db.whatsAppIntegration.upsert({
    where: { id: 'primary' },
    create: {
      id: 'primary',
      status: 'CONNECTING',
      connectionMode: 'COEXISTENCE',
      businessId: value.businessId,
      wabaId: value.wabaId,
      phoneNumberId: initialPhoneId,
      encryptedAccessToken: '',
      scopes: '',
      lastError: '',
    },
    update: {
      status: 'CONNECTING',
      businessId: value.businessId,
      wabaId: value.wabaId,
      phoneNumberId: initialPhoneId,
      lastError: '',
    },
  });

  try {
    const token = await exchangeCode(value.code);
    await subscribeWaba(value.wabaId, token.accessToken);
    const meta = initialPhoneId
      ? await phoneMetadata(initialPhoneId, token.accessToken)
      : await discoverPhoneNumber(value.wabaId, token.accessToken);
    const expiresAt = token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null;
    await db.whatsAppIntegration.update({
      where: { id: 'primary' },
      data: {
        status: 'CONNECTED',
        connectionMode: 'COEXISTENCE',
        businessId: value.businessId,
        wabaId: value.wabaId,
        phoneNumberId: meta.id,
        displayPhoneNumber: meta.displayPhoneNumber,
        verifiedName: meta.verifiedName,
        encryptedAccessToken: encrypt(token.accessToken),
        tokenExpiresAt: expiresAt,
        subscribedAt: now,
        connectedAt: now,
        lastVerifiedAt: now,
        lastError: '',
      },
    });
    return whatsappConnectionStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WhatsApp 连接失败';
    await db.whatsAppIntegration.update({
      where: { id: 'primary' },
      data: { status: 'ERROR', lastError: message },
    });
    throw error;
  }
}
