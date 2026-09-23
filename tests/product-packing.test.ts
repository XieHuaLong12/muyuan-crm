import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePacking, parseGrossWeight, unitsPer40HQ, cbmNeedsReview } from '../lib/product-packing';

test('单箱包装', () => {
  const r = parsePacking('96*96*30');
  assert.equal(r.cartons.length, 1);
  assert.equal(r.cartonCount, 1);
  assert.deepEqual([r.cartons[0].lengthCm, r.cartons[0].widthCm, r.cartons[0].heightCm], [96, 96, 30]);
  assert.equal(r.computedCbm, 0.28);
});

test('件数后缀 = 体积倍数（用报价表真实数据验证）', () => {
  // Y-601 180*90*66：102*28*28 2pc，报价表 CBM 0.16
  const y601 = parsePacking('102*28*28 2pc');
  assert.equal(y601.cartonCount, 2);
  assert.equal(y601.computedCbm, 0.16);
  // Y-605：28*28*98=3件
  assert.equal(parsePacking('28*28*98=3件').cartonCount, 3);
  // 笔误写法 2pec
  assert.equal(parsePacking('115*40*40 2pec').cartonCount, 2);
});

test('4 个数字：带 CTNS 与裸数字都识别为箱数', () => {
  assert.equal(parsePacking('34*34*110*2CTNS').cartonCount, 2);
  assert.equal(parsePacking('125*35*35*2').cartonCount, 2);
});

test('多段相加：不同箱型', () => {
  const y606 = parsePacking('31*31*102+43*45*114');
  assert.equal(y606.cartons.length, 2);
  assert.equal(y606.cartonCount, 2);
  assert.equal(y606.computedCbm, 0.32);

  // Y-611：两段同尺寸，报价表 CBM 0.35
  const y611 = parsePacking('39*39*114+39*39*114');
  assert.equal(y611.cartonCount, 2);
  assert.equal(y611.computedCbm, 0.35);
});

test('多段混合后缀', () => {
  const y612 = parsePacking('34*34*118*2CTNS+30*30*90');
  assert.equal(y612.cartonCount, 3);
  assert.equal(y612.computedCbm, 0.35);

  const y608 = parsePacking('32*32*108 2pc+30*30*108 2pc');
  assert.equal(y608.cartonCount, 4);
});

test('C 系列三箱装（报价表 CBM 0.2）', () => {
  const c301 = parsePacking('100*29*20+101*21*13+110*30*33');
  assert.equal(c301.cartons.length, 3);
  assert.equal(c301.cartonCount, 3);
  assert.equal(c301.computedCbm, 0.19);
});

test('无法识别的段记入 notes，不猜测', () => {
  const r = parsePacking('待确认');
  assert.equal(r.cartons.length, 0);
  assert.equal(r.computedCbm, 0);
  assert.equal(r.notes.length, 1);
  assert.equal(parsePacking('').cartonCount, 0);
  assert.equal(parsePacking(null).cartonCount, 0);
});

test('毛重：单值、倍数、多段、明示合计', () => {
  assert.equal(parseGrossWeight('40').total, 40);
  assert.equal(parseGrossWeight('23.8*2').total, 47.6);
  assert.equal(parseGrossWeight('23.8*2+16.8').total, 64.4);
  const c301 = parseGrossWeight('20.3+17.9+17.7 TOTAL:55.9');
  assert.equal(c301.total, 55.9);
  assert.equal(c301.parts.length, 3);
  assert.equal(parseGrossWeight('16.8+29').total, 45.8);
  assert.equal(parseGrossWeight('').total, null);
});

test('40HQ 装载量与 CBM 冲突判定', () => {
  assert.equal(unitsPer40HQ(0.32), 212); // 68 / 0.32
  assert.equal(unitsPer40HQ(0.16), 425);
  assert.equal(unitsPer40HQ(0), null);
  assert.equal(unitsPer40HQ(null), null);

  // D-612：报价表 0.23，包装推导 0.1 → 必须标记
  assert.equal(cbmNeedsReview(0.23, 0.1), true);
  // C-301：0.2 vs 0.19 → 容差内，不标记
  assert.equal(cbmNeedsReview(0.2, 0.19), false);
});
