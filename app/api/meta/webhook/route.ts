import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

/**
 * /api/meta/webhook
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
  const { verifyMetaSignature, handleWebhookPayload } = await import('@/services/meta-lead-service');

  const verified = verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'));
  if (!verified.ok) {
    // 签名不通过一律 401，且不落库 —— 防止伪造推送往客户库灌数据
    console.warn('[meta-lead] 签名校验失败', { reason: verified.reason });
    return new Response('unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  try {
    const result = await handleWebhookPayload(body);
    if (result.error) console.warn('[meta-lead] 推送解析异常', result.error);
    else console.log(`[meta-lead] 收到 ${result.accepted} 条 leadgen 事件`);
  } catch (error) {
    // 仍返回 200：非 200 会让 Meta 持续重推；事件已登记，可在后台重试
    console.error('[meta-lead] 处理推送失败', error);
  }

  return new Response('EVENT_RECEIVED', { status: 200 });
}
