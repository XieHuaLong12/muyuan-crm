import { MIN_GROUP, pct } from './country-card';

/**
 * AI 计划 (docs/METRICS.md §AI 计划): the pure rules behind the plan page — which ad changes to suggest, and how an
 * adopted one is reviewed after seven days. Suggestions are only ever suggestions: the system never changes an ad,
 * a budget or a message by itself; the person adopts one and makes the change in Meta.
 */
export const REVIEW_AFTER_DAYS = 7;
export type SuggestionKind = 'WEEKDAY_BUDGET' | 'DAYPART' | 'CREATIVE';
export type Candidate = { kind: SuggestionKind; country: string; title: string; body: string; basis: string; weight: number };

/** What the rules read for one country (from the country card). */
export type CountryFacts = {
  country: string; localOffset: string | null;
  days: { label: string; n: number; rate: number | null }[];
  offEntry: { n: number; effectiveRate: number | null; inRate: number | null };
  offShare: number | null; inN: number;
  hours: { start: number; end: number }; localWork: { start: string; end: string } | null;
  ads: { name: string; effective: number; perEffective: number | null }[];
};

export function suggestionsFor(f: CountryFacts): Candidate[] {
  const out: Candidate[] = [];
  const solid = f.days.filter(d => d.n >= MIN_GROUP && d.rate !== null) as { label: string; n: number; rate: number }[];
  if (solid.length >= 2) {
    const top = solid.reduce((a, b) => b.rate > a.rate ? b : a), low = solid.reduce((a, b) => b.rate < a.rate ? b : a);
    if (top.rate - low.rate >= 15) out.push({ kind: 'WEEKDAY_BUDGET', country: f.country, weight: top.rate - low.rate,
      title: `${f.country}：${low.label}预算降 30%，挪到${top.label}`,
      body: `${low.label}进线的 A / B 只占 ${low.rate}%，${top.label}是 ${top.rate}%。同样的钱挪过去，带来的优质线索更多。`,
      basis: `依据：${top.label} ${top.n} 位 · ${low.label} ${low.n} 位进线（${f.country}当地星期）` });
  }
  const { offEntry } = f;
  if (offEntry.n >= MIN_GROUP && f.inN >= MIN_GROUP && offEntry.effectiveRate !== null && offEntry.inRate !== null
    && offEntry.inRate - offEntry.effectiveRate >= 10 && (f.offShare ?? 0) >= 30) {
    out.push({ kind: 'DAYPART', country: f.country, weight: offEntry.inRate - offEntry.effectiveRate,
      title: `${f.country}：只在你的工作时间投放${f.localWork ? `（${f.country} ${f.localWork.start}–${f.localWork.end}）` : ''}`,
      body: `你下班后进线的 A / B 要等到第二天才联系，有效率只有 ${offEntry.effectiveRate}%，工作时间内进线的是 ${offEntry.inRate}%。Meta 要用「总预算」才能设投放时段。`,
      basis: `依据：工作时间外 ${offEntry.n} 位 vs 工作时间内 ${f.inN} 位 A / B` });
  }
  const priced = f.ads.filter(a => a.perEffective !== null && a.effective >= 3) as { name: string; effective: number; perEffective: number }[];
  if (priced.length >= 2) {
    const cheap = priced.reduce((a, b) => b.perEffective < a.perEffective ? b : a), dear = priced.reduce((a, b) => b.perEffective > a.perEffective ? b : a);
    if (dear.perEffective >= cheap.perEffective * 1.5) out.push({ kind: 'CREATIVE', country: f.country, weight: Math.round((dear.perEffective / cheap.perEffective - 1) * 20),
      title: `${f.country}：暂停「${dear.name}」，钱给「${cheap.name}」`,
      body: `前者每个有效客户 ${Math.round(dear.perEffective)}，后者 ${Math.round(cheap.perEffective)}（广告账户币种）。`,
      basis: `依据：${dear.effective} 位 vs ${cheap.effective} 位有效客户 · 花费来自 Meta 按国家的数据` });
  }
  return out;
}

/** The numbers an adopted suggestion is judged by: the country's 有效率 and cost per effective customer, before and after. */
export type ReviewWindow = { ab: number; effective: number; spend: number | null };
export function reviewOf(before: ReviewWindow, after: ReviewWindow) {
  const rate = (w: ReviewWindow) => pct(w.effective, w.ab);
  const cost = (w: ReviewWindow) => w.spend !== null && w.effective > 0 ? Math.round(w.spend / w.effective * 100) / 100 : null;
  const b = { rate: rate(before), cost: cost(before) }, a = { rate: rate(after), cost: cost(after) };
  const better = a.cost !== null && b.cost !== null ? a.cost < b.cost : a.rate !== null && b.rate !== null ? a.rate > b.rate : null;
  const enough = before.ab >= 5 && after.ab >= 5;
  return { before: b, after: a, beforeAb: before.ab, afterAb: after.ab, verdict: !enough ? '样本太少，再看一周' : better === null ? '数据不全' : better ? '有效果，继续保持' : '没有变好，可以改回去' };
}
