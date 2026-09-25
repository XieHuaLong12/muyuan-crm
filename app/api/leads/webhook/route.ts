import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { handle } from '@/lib/http';
import { importLead } from '@/services/lead-import-service';
import { handleWebhookPayload, verifyMetaSignature } from '@/services/meta-lead-service';

export const dynamic = 'force-dynamic';
// 签名校验必须基于**原始请求体**，因此这里不能依赖任何会自动解析 body 的封装
export const runtime = 'nodejs';

/**
 * /api/leads/webhook
 *
 * 两个入口，互不影响：
 *
 *   GET  —— Meta Webhook 验证（hub.mode / hub.verify_token / hub.challenge）
 *   POST —— ① 带 x-webhook-secret 请求头 → 走原有的通用线索接入（行为保持完全不变）
 *           ② 否则 → Meta Lead Ads 推送，先验 X-Hub-Signature-256 再处理 leadgen
 *
 * 说明：这个路径原先由 app/api/[...path]/route.ts 的 catch-all 处理。
 * Next.js 中静态路由优先于 catch-all，因此本文件会接管该路径 ——
 * 为不破坏既有对接，POST 的第一个分支完整保留了原来的密钥校验与 importLead 调用。
 */

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Meta Webhook 验证 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  const expected = process.env.META_LEAD_VERIFY_TOKEN;

  if (!expected) {
    console.error('[meta-lead] META_LEAD_VERIFY_TOKEN 未配置，无法完成 Meta 验证');
    return new NextResponse('verify token not configured', { status: 403 });
  }
  if (mode !== 'subscribe' || !token || !safeEqual(token, expected)) {
    console.warn('[meta-lead] Webhook 验证失败', { mode, hasToken: Boolean(token) });
    return new NextResponse('forbidden', { status: 403 });
  }

  // Meta 要求原样返回 hub.challenge，且必须是纯文本
  console.log('[meta-lead] Webhook 验证通过');
  return new NextResponse(challenge ?? '', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // ── ① 原有通道：x-webhook-secret（保持行为不变）──────────────────
  const genericSecret = process.env.WEBHOOK_SECRET;
  const provided = req.headers.get('x-webhook-secret');
  if (provided) {
    if (!genericSecret || !safeEqual(provided, genericSecret)) {
      console.warn('[leads] x-webhook-secret 校验失败');
      return NextResponse.json({ success: false, error: 'Webhook 密钥无效' }, { status: 401 });
    }
    return handle(async () => {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ success: false, error: '请求体不是合法 JSON' }, { status: 400 });
      }
      return NextResponse.json({ success: true, data: await importLead(body) });
    });
  }

  // ── ② Meta Lead Ads 通道：先验签名 ──────────────────────────────
  const signature = req.headers.get('x-hub-signature-256');
  const verified = verifyMetaSignature(raw, signature);
  if (!verified.ok) {
    // 签名不通过一律 403，且不落库 —— 防止伪造推送写入客户
    console.warn('[meta-lead] 签名校验失败', { reason: verified.reason });
    return new NextResponse('forbidden', { status: 403 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse('invalid json', { status: 400 });
  }

  try {
    const result = await handleWebhookPayload(body);
    if (result.error) console.warn('[meta-lead] 推送解析异常', result.error);
    else console.log(`[meta-lead] 收到 ${result.accepted} 条 leadgen 事件`);
  } catch (error) {
    // 仍然返回 200：非 200 会让 Meta 持续重推，而事件已登记，可在后台重试
    console.error('[meta-lead] 处理推送失败', error);
  }

  return new NextResponse('EVENT_RECEIVED', { status: 200 });
}
