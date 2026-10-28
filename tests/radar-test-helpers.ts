import type { GmailMessage } from '../lib/gmail';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

/** A Gmail API message (format=full) built from plain parts, as the radar's inbox reads it. */
export function gmailMessage(m: { id: string; threadId: string; from: string; subject: string; text?: string; html?: string; headers?: Record<string, string>; report?: string; original?: string; date?: string }): GmailMessage {
  const headers = { From: m.from, To: 'jason@lvanju-mail.com', Subject: m.subject, Date: m.date ?? 'Wed, 28 Oct 2026 10:00:00 +0100', 'Message-ID': `<${m.id}@mail.example>`, ...m.headers };
  const parts = [
    ...(m.text !== undefined ? [{ mimeType: 'text/plain', filename: '', body: { data: b64(m.text) } }] : []),
    ...(m.html !== undefined ? [{ mimeType: 'text/html', filename: '', body: { data: b64(m.html) } }] : []),
    ...(m.report !== undefined ? [{ mimeType: 'message/delivery-status', filename: '', body: { data: b64(m.report) } }] : []),
    ...(m.original !== undefined ? [{ mimeType: 'text/rfc822-headers', filename: '', body: { data: b64(m.original) } }] : []),
  ];
  return { id: m.id, threadId: m.threadId, payload: { mimeType: 'multipart/mixed', headers: Object.entries(headers).map(([name, value]) => ({ name, value })), parts } };
}
