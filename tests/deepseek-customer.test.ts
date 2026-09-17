import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeDeepSeekAnalysis } from '../services/deepseek-customer-service';

const base = {
  intent: 'HIGH',
  customerType: 'IMPORTER',
  products: ['Y-601'],
  quantity: 30,
  currentNeed: '需要报价',
  mainObjection: '运费未知',
  suggestedStage: 'QUOTED',
  nextAction: '询问目的港',
  reason: '明确数量和型号',
  risk: '可能正在比价',
  summary: '高意向进口客户',
  confidence: 90,
};

test('DeepSeek客户分析：评分自动映射为稳定优先级', () => {
  assert.equal(finalizeDeepSeekAnalysis({ ...base, score: 92 }).priority, 'HIGH');
  assert.equal(finalizeDeepSeekAnalysis({ ...base, score: 70 }).priority, 'MEDIUM');
  assert.equal(finalizeDeepSeekAnalysis({ ...base, score: 40 }).priority, 'LOW');
  assert.equal(finalizeDeepSeekAnalysis({ ...base, score: 15 }).priority, 'DORMANT');
});

test('DeepSeek客户分析：拒绝越界评分和非法销售阶段', () => {
  assert.throws(() => finalizeDeepSeekAnalysis({ ...base, score: 101 }));
  assert.throws(() => finalizeDeepSeekAnalysis({ ...base, score: 80, suggestedStage: 'PAY_NOW' }));
});
