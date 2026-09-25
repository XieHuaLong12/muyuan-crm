import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature, extractLeadgenEvents, graphVersion } from '../services/meta-lead-service';
import { mapLeadFields } from '../lib/meta-lead-fields';

/** Facebook 表单的 9 个问题（按需求里列出的原文） */
const facebookForm = [
  { name: 'company_name', label: 'Company name', value: 'Nordic Home AB' },
  { name: 'full_name', label: 'Full name', value: 'Killian Dupont' },
  { name: 'email', label: 'Email', value: 'killian@nordichome.se' },
  { name: 'whatsapp_number', label: 'WhatsApp number', value: '+46 70 123 45 67' },
  { name: 'business_type', label: 'What best describes your business?', value: 'Importer / wholesale' },
  { name: 'market', label: 'Which market or country are you mainly selling to?', value: 'Sweden' },
  { name: 'order_quantity', label: 'Estimated order quantity per model?', value: '100-500' },
  { name: 'compressed', label: 'Are you interested in compressed / roll-packed sofas?', value: 'Yes' },
  { name: 'import_now', label: 'Do you currently import furniture from China?', value: 'No, first time' },
  { name: 'concern', label: 'What is your main concern when sourcing sofas?', value: 'Quality consistency' },
];

test('Facebook 表单答案按字段结构化落库，其余进备注并保留 JSON 原文', () => {
  const mapped = mapLeadFields(facebookForm);
  assert.equal(mapped.companyName, 'Nordic Home AB');
  assert.equal(mapped.name, 'Killian Dupont');
  assert.equal(mapped.email, 'killian@nordichome.se');
  assert.equal(mapped.whatsapp, '+46 70 123 45 67');
  assert.equal(mapped.country, 'Sweden');
  // 自由文本归一为 CRM 的采购类型枚举
  assert.equal(mapped.purchaseType, 'IMPORTER');
  // 「100-500」取上限
  assert.equal(mapped.quantity, 500);
  assert.equal(mapped.productInterest, 'Yes');
  // 未映射到字段的问题保留在备注
  assert.ok(mapped.notes.includes('是否从中国进口：No, first time'));
  assert.ok(mapped.notes.includes('采购主要顾虑：Quality consistency'));
  assert.ok(mapped.notes.includes('表单答案原文：'));
  assert.ok(mapped.notes.includes('Nordic Home AB'));
});

test('字段映射对未知问题与缺失姓名有兜底', () => {
  const mapped = mapLeadFields([
    { name: 'custom_q1', label: 'Something we did not anticipate', value: 'whatever' },
    { name: 'email', label: 'Email', value: 'only-email@example.com' },
  ]);
  // 没给姓名时用邮箱兜底，不能创建无名客户
  assert.equal(mapped.name, 'only-email@example.com');
  assert.equal(mapped.purchaseType, 'OTHER');
  assert.equal(mapped.quantity, null);
  assert.ok(mapped.notes.includes('Something we did not anticipate'));
});

test('X-Hub-Signature-256 校验：正确签名通过，篡改或缺失一律拒绝', () => {
  const secret = 'test-app-secret';
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = secret;
  try {
    const body = JSON.stringify({ object: 'page', entry: [] });
    const good = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
    assert.equal(verifyMetaSignature(body, good).ok, true);
    // 篡改请求体
    assert.equal(verifyMetaSignature(`${body} `, good).ok, false);
    // 伪造签名
    assert.equal(verifyMetaSignature(body, `sha256=${'0'.repeat(64)}`).ok, false);
    // 缺失请求头
    assert.equal(verifyMetaSignature(body, null).ok, false);
    // 长度不同的签名不能触发 timingSafeEqual 抛错
    assert.equal(verifyMetaSignature(body, 'sha256=short').ok, false);
  } finally {
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  }
});

test('缺少 META_APP_SECRET 时拒绝一切推送（不静默放行）', () => {
  const previous = process.env.META_APP_SECRET;
  delete process.env.META_APP_SECRET;
  try {
    assert.equal(verifyMetaSignature('{}', 'sha256=whatever').ok, false);
  } finally {
    if (previous !== undefined) process.env.META_APP_SECRET = previous;
  }
});

test('解析 Meta 推送体，只取 leadgen 字段', () => {
  const events = extractLeadgenEvents({
    object: 'page',
    entry: [{
      id: 'page-1',
      changes: [
        { field: 'leadgen', value: { leadgen_id: 'LEAD_A', page_id: 'page-1', form_id: 'form-9' } },
        { field: 'feed', value: { leadgen_id: 'IGNORED', page_id: 'page-1', form_id: 'x' } },
      ],
    }],
  });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { leadgenId: 'LEAD_A', pageId: 'page-1', formId: 'form-9' });
  // 非 leadgen 推送不应报错，只是没有事件
  assert.deepEqual(extractLeadgenEvents({ object: 'page', entry: [{ changes: [] }] }), []);
});

test('Graph API 版本走配置，并有默认值', () => {
  const previous = process.env.META_GRAPH_VERSION;
  try {
    process.env.META_GRAPH_VERSION = 'v21.0';
    assert.equal(graphVersion(), 'v21.0');
    delete process.env.META_GRAPH_VERSION;
    assert.equal(graphVersion(), 'v26.0');
  } finally {
    if (previous !== undefined) process.env.META_GRAPH_VERSION = previous;
  }
});
