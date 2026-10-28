import { createHash } from 'node:crypto';

/**
 * Gmail REST client for the customer radar's sending mailboxes (docs/CUSTOMER_RADAR_COLD_EMAIL.md): OAuth for an
 * internal Google Workspace app, sending, and reading the inbox. Only fetch — no SDK. Errors say what to do next:
 * AUTH (reconnect the mailbox), LIMIT (Gmail is throttling the sender: pause it), TEMPORARY (retry later),
 * PERMANENT (this message can never go, e.g. a malformed recipient).
 */

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type GmailErrorKind = 'AUTH' | 'LIMIT' | 'TEMPORARY' | 'PERMANENT';
export class GmailError extends Error {
  constructor(message: string, public kind: GmailErrorKind, public status = 0) { super(message); }
}

export const gmailConfigured = () => !!process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && !!process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
const client = () => {
  if (!gmailConfigured()) throw new GmailError('尚未配置 GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET', 'AUTH');
  return { id: process.env.GOOGLE_OAUTH_CLIENT_ID!.trim(), secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!.trim() };
};

/** Google's consent page. offline + consent so Google returns a refresh token every time a mailbox is connected. */
export function gmailAuthUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({ client_id: client().id, redirect_uri: redirectUri, response_type: 'code', scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** What an HTTP failure means for the sender. */
export function classifyGmail(status: number, reason: string, message: string): GmailErrorKind {
  if (status === 401 || reason === 'invalid_grant' || reason === 'insufficientPermissions' || reason === 'unauthorized_client') return 'AUTH';
  // A per-second rate limit is only a retry; a sending or daily limit means Gmail is throttling the sender.
  const sendingLimit = reason === 'dailyLimitExceeded' || reason === 'quotaExceeded' || (/limit exceeded|sending limit|daily limit/i.test(message) && !/rate/i.test(reason));
  if (sendingLimit) return 'LIMIT';
  if (status === 429 || status >= 500 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || reason === 'backendError') return 'TEMPORARY';
  return 'PERMANENT';
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }); }
  catch (error) { throw new GmailError(`连不上 Gmail：${error instanceof Error ? error.message : 'network'}`, 'TEMPORARY'); }
  const body = await response.json().catch(() => ({})) as { error?: string | { code?: number; message?: string; errors?: { reason?: string }[]; status?: string }; error_description?: string };
  if (response.ok) return body as T;
  const reason = typeof body.error === 'string' ? body.error : body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
  const message = typeof body.error === 'string' ? body.error_description ?? body.error : body.error?.message ?? `HTTP ${response.status}`;
  throw new GmailError(`Gmail：${message}`.slice(0, 480), classifyGmail(response.status, reason, message), response.status);
}

const form = (values: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() });

/** Exchanges the consent code for tokens; Google only returns a refresh token with prompt=consent. */
export async function exchangeCode(code: string, redirectUri: string) {
  const { id, secret } = client();
  const tokens = await call<{ access_token: string; refresh_token?: string; expires_in: number }>(TOKEN_URL,
    form({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }));
  if (!tokens.refresh_token) throw new GmailError('Google 没有返回刷新令牌，请在 Google 账号的「第三方访问」里移除本应用后重新连接', 'AUTH');
  remember(tokens.refresh_token, tokens.access_token, tokens.expires_in);
  return { refreshToken: tokens.refresh_token, accessToken: tokens.access_token };
}

const cache = new Map<string, { token: string; until: number }>();
const keyOf = (refreshToken: string) => createHash('sha256').update(refreshToken).digest('hex');
const remember = (refreshToken: string, token: string, seconds: number) => cache.set(keyOf(refreshToken), { token, until: Date.now() + (seconds - 120) * 1000 });

/** An access token for a mailbox, reused until two minutes before it expires. */
export async function accessToken(refreshToken: string) {
  const hit = cache.get(keyOf(refreshToken));
  if (hit && hit.until > Date.now()) return hit.token;
  const { id, secret } = client();
  const tokens = await call<{ access_token: string; expires_in: number }>(TOKEN_URL, form({ refresh_token: refreshToken, client_id: id, client_secret: secret, grant_type: 'refresh_token' }));
  remember(refreshToken, tokens.access_token, tokens.expires_in);
  return tokens.access_token;
}

const auth = (token: string, json = false) => ({ Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });

export async function gmailProfile(token: string) {
  return call<{ emailAddress: string; historyId: string }>(`${API}/profile`, { headers: auth(token) });
}

/** Sends a complete MIME message; a threadId keeps a follow-up in the sender's thread. */
export async function sendMessage(token: string, mime: string, threadId?: string | null) {
  return call<{ id: string; threadId: string }>(`${API}/messages/send`, { method: 'POST', headers: auth(token, true),
    body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url'), ...(threadId ? { threadId } : {}) }) });
}

type Header = { name: string; value: string };
export type GmailPart = { mimeType?: string; filename?: string; headers?: Header[]; body?: { data?: string; size?: number }; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; snippet?: string; payload?: GmailPart };

export async function getMessage(token: string, id: string, format: 'metadata' | 'full' = 'full', headers: string[] = []) {
  const query = new URLSearchParams({ format });
  for (const name of headers) query.append('metadataHeaders', name);
  return call<GmailMessage>(`${API}/messages/${encodeURIComponent(id)}?${query}`, { headers: auth(token) });
}

/** A header of a message, case-insensitively. */
export const headerOf = (message: GmailMessage | GmailPart | undefined, name: string) => {
  const headers = ('payload' in (message ?? {}) ? (message as GmailMessage).payload?.headers : (message as GmailPart | undefined)?.headers) ?? [];
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
};

/** Messages added to the inbox since a history id. A history id older than about a week answers 404: list instead. */
export async function inboxHistory(token: string, startHistoryId: string) {
  const ids: string[] = [];
  let pageToken = '', latest = startHistoryId;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '500', ...(pageToken ? { pageToken } : {}) });
    const body = await call<{ history?: { messagesAdded?: { message: { id: string } }[] }[]; historyId?: string; nextPageToken?: string }>(`${API}/history?${query}`, { headers: auth(token) });
    for (const h of body.history ?? []) for (const added of h.messagesAdded ?? []) ids.push(added.message.id);
    latest = body.historyId ?? latest;
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return { ids: [...new Set(ids)], historyId: latest };
}

export async function listInbox(token: string, query: string) {
  const body = await call<{ messages?: { id: string }[] }>(`${API}/messages?${new URLSearchParams({ q: query, labelIds: 'INBOX', maxResults: '200' })}`, { headers: auth(token) });
  return (body.messages ?? []).map(m => m.id);
}
