import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountId, leadCountFromActions, metricRowsFromInsights } from '../services/meta-ads-service';
import { formRowsFromPayload } from '../services/meta-form-service';

test('广告账户 ID 归一化：act_ 前缀与空白都能处理', () => {
  assert.equal(normalizeAccountId('act_123456789'), '123456789');
  assert.equal(normalizeAccountId('  act_987654321  '), '987654321');
  assert.equal(normalizeAccountId('555555'), '555555');
});

test('线索数从 actions 提取：优先 lead，回退 lead_grouped，异常值归零', () => {
  assert.equal(leadCountFromActions([{ action_type: 'lead', value: '7' }, { action_type: 'post_engagement', value: '12' }]), 7);
  assert.equal(leadCountFromActions([{ action_type: 'onsite_conversion.lead_grouped', value: '3' }]), 3);
  assert.equal(leadCountFromActions([{ action_type: 'video_view', value: '99' }]), 0);
  assert.equal(leadCountFromActions(undefined), 0);
  assert.equal(leadCountFromActions([]), 0);
  assert.equal(leadCountFromActions([{ action_type: 'lead', value: 'not-a-number' }]), 0);
});

test('insights 行 → 指标行：金额/数量解析、日期取 date_start、脏数据跳过', () => {
  const rows = metricRowsFromInsights([
    {
      campaign_id: '23840000000000123',
      campaign_name: 'Sofa EU Lead Gen',
      date_start: '2026-09-20',
      date_stop: '2026-09-20',
      spend: '18.42',
      impressions: '1234',
      clicks: '56',
      ctr: '4.54',
      account_currency: 'USD',
      actions: [{ action_type: 'lead', value: '2' }],
    },
    {
      campaign_id: '23840000000000456',
      campaign_name: '',
      date_start: 'not-a-date',
      date_stop: '2026-09-20',
      spend: '1.00',
      impressions: '0',
      clicks: '0',
      account_currency: 'CNY',
    },
    'garbage',
  ]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.campaignId, '23840000000000123');
  assert.equal(row.campaignName, 'Sofa EU Lead Gen');
  assert.equal(row.metricDate.toISOString(), '2026-09-20T00:00:00.000Z');
  assert.equal(row.spend, 18.42);
  assert.equal(row.impressions, 1234);
  assert.equal(row.clicks, 56);
  assert.equal(row.leads, 2);
  assert.equal(row.currency, 'USD');
});

test('leadgen_forms 原始行 → 表单行：字段映射与脏数据跳过', () => {
  const rows = formRowsFromPayload([
    {
      id: '111111111111111',
      name: 'Furniture Inquiry EN',
      status: 'ACTIVE',
      questions: [{ key: 'email', label: 'Email', type: 'EMAIL' }],
      leads_count: 41,
    },
    {
      id: '222222222222222',
      name: 'Catalogue Download',
      status: 'INACTIVE',
      questions: [],
      leads_count: 0,
    },
    { id: 42 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].formId, '111111111111111');
  assert.equal(rows[0].name, 'Furniture Inquiry EN');
  assert.equal(rows[0].leadsCount, 41);
  assert.deepEqual(rows[0].questions, [{ key: 'email', label: 'Email', type: 'EMAIL' }]);
  assert.equal(rows[1].leadsCount, 0);
});
