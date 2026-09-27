import { NextRequest } from 'next/server';
import { randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * /api/leads/webhook
 *
 * ⚠️ 本文件顶部的 import 必须保持极简（只允许 next/server 与 node 内置模块）。
 *
 * 原因：Next.js 在**模块加载期**就会执行所有顶层 import。此前这里顶层引了
 * lead-import-service / meta-lead-service，那条链会拉起 Prisma 客户端与整棵依赖图；
 * 一旦初始化失败（缺 DATABASE_URL、引擎起不来、冷启动超时），连不需要数据库的
 * GET 验证也会一起挂掉 —— 在 Meta 侧表现为 ERR_CONNECTION_CLOSED。
 *
 * 因此 GET 完全不碰数据库/Service，POST 需要什么就动态 import。
 */

/** 常量时间比较，避免通过响应时间逐字节猜出 verify token。 */
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Meta Webhook 验证。
 *
 *   GET /api/leads/webhook?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=123
 *
 * 通过时必须**纯文本原样返回 hub.challenge**。
 * 这里不查询数据库、不调用 service、不调用 Graph API —— 验证必须完全独立。
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge') ?? '';
  // 优先新名；兼容早期部署已配置的旧名，避免改名后静默失效
  const expected = process.env.META_LEAD_WEBHOOK_SECRET?.trim() || process.env.META_LEAD_VERIFY_TOKEN?.trim();

  if (mode === 'subscribe' && expected && token && safeEqual(token, expected)) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  console.warn('[meta-lead] Webhook 验证未通过', {
    mode,
    hasToken: Boolean(token),
    configured: Boolean(expected),
  });
  return new Response('forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * 接收推送。两个通道：
 *   ① 带 x-webhook-secret 请求头 → 原有通用线索接入（行为与改动前完全一致）
 *   ② 否则 → Meta Lead Ads：先验 X-Hub-Signature-256，再处理 leadgen
 *
 * service 全部在 POST 内部动态 import：GET 验证不承担任何加载成本。
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // ── ① 原有通道：x-webhook-secret（保留旧逻辑，不受影响）─────────────
  const provided = req.headers.get('x-webhook-secret');
  if (provided) {
    const genericSecret = process.env.WEBHOOK_SECRET;
    if (!genericSecret || !safeEqual(provided, genericSecret)) {
      console.warn('[leads] x-webhook-secret 校验失败');
      return Response.json({ success: false, error: 'Webhook 密钥无效' }, { status: 401 });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ success: false, error: '请求体不是合法 JSON' }, { status: 400 });
    }
    const { importLead } = await import('@/services/lead-import-service');
    return Response.json({ success: true, data: await importLead(body) });
  }

  // ── ② Meta Lead Ads 通道 ─────────────────────────────────────────
  // 仅记录接收状态和计数，不记录请求体、密钥、签名或客户个人资料。
  // 入口日志必须放在签名校验之前，否则 401 事件无法与“Meta 未投递”区分。
  const requestId = randomUUID().slice(0, 8);
  console.info('[meta-lead] POST received', {
    requestId,
    bytes: Buffer.byteLength(raw, 'utf8'),
    hasSignature: Boolean(req.headers.get('x-hub-signature-256')),
  });

  const { verifyMetaSignature, handleWebhookPayload } = await import('@/services/meta-lead-service');

  const verified = verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'));
  if (!verified.ok) {
    // 签名不通过一律 401，且不落库 —— 防止伪造推送往客户库灌数据
    console.warn('[meta-lead] signature failed', { requestId, reason: verified.reason });
    return new Response('unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  console.info('[meta-lead] signature valid', { requestId });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    console.warn('[meta-lead] invalid payload', { requestId, reason: 'invalid json' });
    return new Response('invalid json', { status: 400 });
  }

  try {
    const result = await handleWebhookPayload(body, requestId);
    console.info('[meta-lead] processing summary', {
      requestId,
      accepted: result.accepted,
      statuses: result.results.map(item => item.status),
      hasProcessingError: Boolean(result.error),
    });
    if (!result.accepted && !result.error) {
      // A valid signed request can have no leadgen changes (including the empty-body signature smoke test).
      // Return 200 for non-lead events, but leave a trace so it is not mistaken for an imported lead.
      console.warn('[meta-lead] no leadgen changes in signed payload', { requestId });
    }
    if (result.error) {
      if (!result.accepted) console.warn('[meta-lead] invalid payload', { requestId });
      console.warn('[meta-lead] customer processing failed', { requestId, failed: result.results.filter(item => item.status === 'FAILED').length });
      return new Response('processing failed', { status: 503 });
    }
    console.log(`[meta-lead] 已处理 ${result.accepted} 条 leadgen 事件`);
  } catch (error) {
    console.error('[meta-lead] customer processing failed', { requestId, errorType: error instanceof Error ? error.name : 'unknown' });
    return new Response('processing failed', { status: 503 });
  }

  return new Response('EVENT_RECEIVED', { status: 200 });
}
