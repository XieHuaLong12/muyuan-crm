#!/usr/bin/env node
/**
 * Meta Lead Ads 全链路诊断
 *
 * 用法：
 *   node scripts/meta-lead-doctor.mjs                    # 只做只读检查
 *
 * 它依次检查：环境变量 → Webhook 验证 → Graph API → Page 订阅。
 * **绝不打印任何密钥内容**，只报告存在与否。
 *
 * 为什么需要它：Meta 后台点「验证并保存」失败时，错误信息只有
 * ERR_CONNECTION_CLOSED 之类，无法区分是代码、部署、变量还是网络。
 * 这个脚本在**你自己机器上**逐段跑，能直接指出断在哪一环。
 */

import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const DOMAIN = process.env.PUBLIC_APP_URL?.trim() || 'https://avenlee.online';
const PAGE_ID = process.env.META_PAGE_ID?.trim() || '888983754306369';
const VERSION = process.env.META_GRAPH_VERSION?.trim() || 'v26.0';

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n── ${title} ─────────────────────────────`);
}

/** 只报告是否存在，不打印值 */
function envCheck(name, required = true) {
  const value = process.env[name]?.trim();
  const ok = Boolean(value);
  if (!ok && !required) return true;
  return ok;
}

async function main() {
  section('1. 环境变量（只检查是否存在）');
  const verifyToken = process.env.META_LEAD_WEBHOOK_SECRET?.trim() || process.env.META_LEAD_VERIFY_TOKEN?.trim() || '';
  for (const [name, required] of [
    ['META_LEAD_WEBHOOK_SECRET', true],
    ['META_LEAD_VERIFY_TOKEN', false],
    ['META_PAGE_ACCESS_TOKEN', true],
    ['META_APP_SECRET', true],
    ['META_GRAPH_VERSION', false],
  ]) {
    const ok = envCheck(name);
    record(name, ok || !required, ok ? '已配置' : required ? '未配置（必填）' : '未配置（可选）');
  }
  if (!verifyToken) {
    console.log('\n⚠️  没有可用的验证 token，后续步骤会失败。');
    console.log('   请在 Hostinger → Environment variables 配置 META_LEAD_WEBHOOK_SECRET 后重新部署。');
  }

  section('2. Webhook 验证（Meta 点「验证并保存」时发的就是这条）');
  if (!verifyToken) {
    record('GET 验证', false, '跳过：没有验证 token');
  } else {
    const url = `${DOMAIN}/api/leads/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=test123`;
    console.log(`   GET ${DOMAIN}/api/leads/webhook?hub.mode=subscribe&hub.verify_token=***&hub.challenge=test123`);
    try {
      const response = await fetch(url, { redirect: 'manual' });
      const text = (await response.text()).trim();
      if (response.status === 200 && text === 'test123') {
        record('GET 验证', true, `HTTP 200，原样返回 test123`);
      } else if (response.status === 403) {
        record('GET 验证', false, `HTTP 403 —— token 不匹配：检查 META_LEAD_WEBHOOK_SECRET 的值是否与 Meta 后台填写的一致`);
      } else if (response.status === 404) {
        record('GET 验证', false, `HTTP 404 —— 路由不存在：部署的还是旧版本，请重新部署`);
      } else {
        record('GET 验证', false, `HTTP ${response.status}，响应体：${text.slice(0, 120)}`);
      }
    } catch (error) {
      record('GET 验证', false, `连接失败：${error.message}`);
      console.log('   这不是代码问题：检查 DNS 解析、SSL 证书、以及 Hostinger 的代理/WAF 是否拦截了带查询参数的请求。');
    }
  }

  section('3. Graph API（用 META_PAGE_ACCESS_TOKEN 读 Page 信息）');
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!pageToken) {
    record('Graph API /me', false, '跳过：META_PAGE_ACCESS_TOKEN 未配置');
  } else {
    try {
      const response = await fetch(`https://graph.facebook.com/${VERSION}/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`);
      const json = await response.json().catch(() => ({}));
      if (response.ok && json.id) {
        record('Graph API /me', true, `Page: ${json.name ?? '(无名称)'} · ID ${json.id}`);
        if (String(json.id) !== PAGE_ID) {
          record('Page ID 一致性', false, `token 属于 ${json.id}，但期望 ${PAGE_ID} —— 用错 Page 的 token 会拉不到线索`);
        } else {
          record('Page ID 一致性', true, `与 ${PAGE_ID} 一致`);
        }
      } else {
        const err = json.error ?? {};
        record('Graph API /me', false, `${err.message ?? `HTTP ${response.status}`}${err.code ? ` (code ${err.code})` : ''}`);
        if (err.code === 190) console.log('   → token 无效或已过期，请在 Meta 后台重新生成 Page Access Token。');
        if (err.code === 200) console.log('   → 权限不足，确认已授予 pages_show_list / leads_retrieval / pages_read_engagement。');
      }
    } catch (error) {
      record('Graph API /me', false, `请求失败：${error.message}`);
    }
  }

  section('4. Page 订阅检查');
  if (!pageToken) {
    record('Page 订阅', false, '跳过：缺少 token');
  } else {
    try {
      const response = await fetch(`https://graph.facebook.com/${VERSION}/${PAGE_ID}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`);
      const json = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(json.data)) {
        const leadgen = json.data.some(app => (app.subscribed_fields ?? []).includes('leadgen'));
        record('leadgen 已订阅', leadgen, leadgen ? '已在订阅字段中' : '未订阅 leadgen —— 到 Meta 后台 Webhooks → Page 勾选 leadgen');
      } else {
        record('Page 订阅', false, json.error?.message ?? `HTTP ${response.status}`);
      }
    } catch (error) {
      record('Page 订阅', false, `请求失败：${error.message}`);
    }
  }

  section('5. 空 entry 签名探针（仅验证入口，不写客户或事件）');
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) {
    record('POST 模拟', false, '跳过：META_APP_SECRET 未配置');
  } else {
    const body = JSON.stringify({ object: 'page', entry: [] });
    const signature = `sha256=${createHmac('sha256', appSecret).update(body, 'utf8').digest('hex')}`;
    try {
      const response = await fetch(`${DOMAIN}/api/leads/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
        body,
      });
      const text = (await response.text()).trim();
      if (response.status === 200) {
        record('POST 验签通过', true, `HTTP 200 ${text}`);
        console.log('   这仅验证入口和验签；要验证入库，请在真实 Instant Form 提交新测试 Lead。');
      } else if (response.status === 401) {
        record('POST 验签通过', false, 'HTTP 401 —— META_APP_SECRET 与 Meta App 的不一致');
      } else {
        record('POST 验签通过', false, `HTTP ${response.status} ${text.slice(0, 120)}`);
      }
    } catch (error) {
      record('POST 验签通过', false, `连接失败：${error.message}`);
    }

    // 签名错误的请求必须被拒绝
    try {
      const response = await fetch(`${DOMAIN}/api/leads/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' },
        body,
      });
      record('伪造签名被拒', response.status === 401, `HTTP ${response.status}（应为 401）`);
    } catch (error) {
      record('伪造签名被拒', false, `连接失败：${error.message}`);
    }
  }

  section('结果');
  const failed = results.filter(r => !r.ok);
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log('\n需要处理的项：');
    for (const f of failed) console.log(`  ✗ ${f.step} — ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log('\n入口检查通过。请用真实 Instant Form 新测试 Lead 验证投递、Graph 读取及客户入库。');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
