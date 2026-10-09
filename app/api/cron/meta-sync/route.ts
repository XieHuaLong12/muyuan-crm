import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

/**
 * /api/cron/meta-sync —— Meta 广告数据与表单目录的定时同步入口
 *
 * 由 Hostinger 面板的 Cron Jobs 每 6 小时请求一次（推荐把密钥放在请求头，避免写进访问日志）：
 *   curl -H "x-cron-secret: <META_SYNC_SECRET>" https://你的域名/api/cron/meta-sync
 * 兼容旧配置：GET https://你的域名/api/cron/meta-sync?secret=<META_SYNC_SECRET>
 *
 * 可选 kind 参数：all（默认，广告+表单）| ads | forms
 *
 * ⚠️ 顶部 import 保持极简（next/server + node 内置模块），service 一律动态加载：
 * 与 /api/leads/webhook 同一教训 —— 顶层 import 会拉起 Prisma 与整棵依赖图，
 * 冷启动失败时连「密钥校验」这种不需要数据库的响应都发不出去。
 */

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function GET(req: NextRequest) {
  // 推荐用请求头 x-cron-secret，避免密钥进入访问日志；?secret= 仅为兼容已配置的定时任务保留。
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret') || '';
  const expected = process.env.META_SYNC_SECRET?.trim() ?? '';
  if (!expected || !secret || !safeEqual(secret, expected)) {
    console.warn('[meta-sync] cron 密钥校验失败', { hasSecret: Boolean(secret), configured: Boolean(expected) });
    return new Response('forbidden', { status: 403 });
  }

  const kind = req.nextUrl.searchParams.get('kind') ?? 'all';
  const results: Record<string, unknown> = {};
  if (kind === 'ads' || kind === 'all') {
    const { syncAds } = await import('@/services/meta-ads-service');
    results.ads = await syncAds();
  }
  if (kind === 'forms' || kind === 'all') {
    const { syncLeadForms } = await import('@/services/meta-form-service');
    results.forms = await syncLeadForms();
  }
  if (!results.ads && !results.forms) {
    return new Response('invalid kind', { status: 400 });
  }

  return Response.json({ success: true, data: { kind, results, time: new Date().toISOString() } });
}
