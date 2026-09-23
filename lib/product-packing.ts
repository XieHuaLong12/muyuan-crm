/**
 * 包装与毛重解析
 *
 * 源数据（报价表 / 图册）的包装写法不统一，实测存在以下形态：
 *   96*96*35                          单箱
 *   102*28*28 2pc                     3 维 + 件数后缀
 *   28*28*98=3件                       3 维 += 件数
 *   34*34*110*2CTNS                   4 个数字，第 4 个带 CTNS
 *   125*35*35*2                       4 个数字，第 4 个是裸数字
 *   25*25*128+42*42*117               多段相加（不同箱型）
 *   32*32*108 2pc+30*30*108 2pc       段内带件数 + 多段
 *   34*34*118*2CTNS+30*30*90          多段，混合有无后缀
 *   100*29*20+101*21*13+110*30*33     C 系列床，3 箱
 *   115*40*40 2pec                    "pec" 是 "pc" 的笔误
 *
 * 关键结论（已用真实数据验证）：
 *   后缀的数字是「体积倍数」，等价于纸箱数量。
 *   Y-601 180*90*66: 102*28*28*2 = 0.1599 m³ ≈ 报价表 0.16 ✓
 *   Y-611:          39*39*114*2 = 0.3468 m³ ≈ 报价表 0.35 ✓
 *   C-301:          0.0580+0.0276+0.1089 = 0.1945 ≈ 报价表 0.20 ✓
 *
 * 本模块只做解析与「推导值」计算，**不修改权威值**。
 * 推导值与权威值偏差超过容差时，由调用方标记 needsReview。
 */

export type ParsedCarton = {
  label: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  cartonCount: number;
  piecesPerCarton: number;
};

export type ParsedPacking = {
  cartons: ParsedCarton[];
  cartonCount: number;
  computedCbm: number;
  notes: string[];
};

/** 权威值与包装推导值的相对偏差超过该比例时，认为数据需要人工核对。 */
export const CBM_TOLERANCE = 0.15;

function toNumber(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 解析单段，例如 "102*28*28 2pc" 或 "100*29*20"。
 * 返回 null 表示该段无法识别（调用方记入 notes，不猜测）。
 */
function parseSegment(segment: string): { carton: ParsedCarton; note?: string } | null {
  const cleaned = segment
    .replace(/[×✕]/g, '*')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  // 摘出尾部的数量后缀（pc / CTNS / 件 / 裸数字）
  const suffix = cleaned.match(/(?:[*=]\s*)?(\d+)\s*(ctns?|cartons?|pcs?|pec|pieces?|件|个)\s*$/i);
  let body = cleaned;
  let count = 1;

  if (suffix) {
    count = toNumber(suffix[1]) ?? 1;
    body = cleaned.slice(0, suffix.index).trim();
  }

  const parts = body
    .split('*')
    .map(p => p.trim())
    .filter(Boolean);
  const numbers = parts.map(toNumber);

  if (numbers.some(n => n === null) || numbers.length < 3) return null;

  const [lengthCm, widthCm, heightCm] = numbers as number[];

  // 第 4 个裸数字也是数量，例如 "125*35*35*2"
  if (!suffix && numbers.length >= 4) {
    count = numbers[3] as number;
  }

  return {
    carton: {
      label: '',
      lengthCm,
      widthCm,
      heightCm,
      cartonCount: count,
      piecesPerCarton: 1,
    },
  };
}

export function parsePacking(raw: string | null | undefined): ParsedPacking {
  const notes: string[] = [];
  const cartons: ParsedCarton[] = [];

  const source = String(raw ?? '').trim();
  if (!source) return { cartons, cartonCount: 0, computedCbm: 0, notes };

  for (const segment of source.split('+')) {
    const parsed = parseSegment(segment);
    if (!parsed) {
      if (segment.trim()) notes.push(`无法识别包装段：${segment.trim()}`);
      continue;
    }
    cartons.push(parsed.carton);
  }

  const cartonCount = cartons.reduce((sum, c) => sum + c.cartonCount, 0);
  const computedCbm =
    Math.round(
      cartons.reduce((sum, c) => sum + c.lengthCm * c.widthCm * c.heightCm * c.cartonCount, 0) / 1e4,
    ) / 100;

  return { cartons, cartonCount, computedCbm, notes };
}

/**
 * 毛重写法同样不统一：
 *   "40"           单值
 *   "23.8*2"       倍数
 *   "23.8*2+16.8"  多段相加
 *   "20.3+17.9+17.7 TOTAL:55.9"  分段 + 明示合计
 *   "16.8+29"      分段
 * 返回值中的 parts 用于回填单箱重量，total 为权威毛重。
 */
export function parseGrossWeight(raw: string | null | undefined): {
  total: number | null;
  parts: number[];
  note?: string;
} {
  const source = String(raw ?? '').trim();
  if (!source) return { total: null, parts: [] };

  const explicitTotal = source.match(/total\s*[:：]?\s*([\d.]+)/i);
  const body = source.replace(/total\s*[:：]?\s*[\d.]+\s*/i, '').trim();

  const parts: number[] = [];
  const notes: string[] = [];

  for (const segment of body.split('+')) {
    const piece = segment.replace(/[^\d.*]/g, '').trim();
    if (!piece) continue;
    const [value, multiplier] = piece.split('*');
    const base = toNumber(value ?? '');
    if (base === null) {
      notes.push(`无法识别毛重段：${segment.trim()}`);
      continue;
    }
    const times = multiplier !== undefined ? toNumber(multiplier) ?? 1 : 1;
    for (let i = 0; i < times; i += 1) parts.push(base);
  }

  const sum = Math.round(parts.reduce((s, v) => s + v, 0) * 100) / 100;
  const total = explicitTotal ? Number(explicitTotal[1]) : parts.length ? sum : null;

  return { total, parts, note: notes.length ? notes.join('；') : undefined };
}

/** 单柜（40HQ）可装载数量。40HQ 可用容积按 68 m³ 估算，需业务确认。 */
export const FORTY_HQ_CBM = 68;

export function unitsPer40HQ(cbm: number | string | null | undefined): number | null {
  const value = typeof cbm === 'string' ? Number(cbm) : cbm;
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(FORTY_HQ_CBM / value);
}

/** 权威 CBM 与包装推导 CBM 是否冲突。 */
export function cbmNeedsReview(authoritative: number, computed: number): boolean {
  if (!authoritative || !computed) return true;
  const diff = Math.abs(authoritative - computed);
  return diff / Math.max(authoritative, computed) > CBM_TOLERANCE;
}
