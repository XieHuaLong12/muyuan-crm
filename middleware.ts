import { NextRequest, NextResponse } from 'next/server';

// Machine-to-machine endpoints authenticate with their own signatures, secrets or extension tokens.
const EXEMPT_PREFIXES = ['/api/leads/webhook', '/api/meta/webhook', '/api/whatsapp/webhook', '/api/cron/', '/api/whatsapp/web-sync/'];

function trustedOrigin(req: NextRequest, origin: string) {
  try {
    const parsed = new URL(origin);
    const hosts = [req.headers.get('host'), req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()].filter(Boolean);
    return ['http:', 'https:'].includes(parsed.protocol) && hosts.includes(parsed.host);
  } catch {
    return false;
  }
}

/** One cross-site request check for every cookie-authenticated API mutation, not only the catch-all route. */
export function middleware(req: NextRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (EXEMPT_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) return NextResponse.next();
  const origin = req.headers.get('origin');
  const crossSite = req.headers.get('sec-fetch-site') === 'cross-site';
  if (crossSite || (origin && !trustedOrigin(req, origin))) {
    return NextResponse.json({ success: false, error: '请求来源不受信任' }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
