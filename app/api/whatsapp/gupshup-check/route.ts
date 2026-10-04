export const dynamic = 'force-dynamic';

function check(req: Request) {
  if (Date.now() >= Date.UTC(2026, 9, 5)) return new Response(null, { status: 404 });
  console.info('[Gupshup URL Check]', JSON.stringify({
    method: req.method,
    ip: req.headers.get('x-forwarded-for')?.slice(0, 200),
    userAgent: req.headers.get('user-agent')?.slice(0, 200),
  }));
  return new Response(null, { status: 204 });
}

export const GET = check;
export const HEAD = check;
export const POST = check;
export const OPTIONS = check;
