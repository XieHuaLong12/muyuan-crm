'use client';
import { useState } from 'react';
import { money, number, percent } from './AnalyticsParts';

type Campaign = { key: string; name: string; spend: number; ab: number; effective: number; won: number; spendShare: number | null; effectiveShare: number | null; perEffective: number | null };
type Level = { key: string; name: string; ab: number; effective: number; won: number; rate: number | null };
const LEVELS = [['campaign', '广告系列'], ['adset', '广告组'], ['ad', '广告素材']] as const;

/**
 * 广告效果's detail: per campaign, the share of the money next to the share of effective customers and what each one
 * cost; per ad set and ad, conversions only (Meta's spend is synced per campaign).
 */
export function AdLevels({ currency, campaigns, adsets, ads, overall }: { currency: string | null; campaigns: Campaign[]; adsets: Level[]; ads: Level[]; overall: number | null }) {
  const [level, setLevel] = useState<(typeof LEVELS)[number][0]>('campaign');
  const rows = level === 'adset' ? adsets : ads;
  const cost = (value: number | null) => value === null ? '—' : money(value, currency);
  // Against the cost of an effective customer over all campaigns: at or below it green, 30% above it red.
  const tone = (value: number | null) => value === null ? 'is-none' : overall === null || value <= overall ? '' : value > overall * 1.3 ? 'is-high' : 'is-mid';
  return (
    <>
      <div className="cockpit-section-head">
        <div><h2>钱花在哪，有效客户从哪来</h2><p>{level === 'campaign' ? '每个广告系列：花费占比 对比 有效客户占比，右边是每个有效客户的花费' : 'Meta 只同步到广告系列的花费，这一层只看转化'}</p></div>
        <span className="analytics-toggle" role="tablist" aria-label="看哪一层">
          {LEVELS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={level === key} onClick={() => setLevel(key)}>{label}</button>)}
        </span>
      </div>
      {level === 'campaign' ? (campaigns.length ? campaigns.map(c => (
        <div key={c.key} className="ca-campaign">
          <div className="ca-campaign-name"><strong>{c.name}</strong><small>{cost(c.spend)} · {number(c.ab)} 位 A/B · 有效 {number(c.effective)}{c.won ? ` · 成交 ${c.won}` : ''}</small></div>
          <div className="ca-campaign-bars">
            <span>花费</span><span className="ca-bar"><i className="is-spend" style={{ width: `${c.spendShare ?? 0}%` }} /></span><b>{percent(c.spendShare === null ? null : Math.round(c.spendShare))}</b>
            <span>有效客户</span><span className="ca-bar"><i className="is-effective" style={{ width: `${c.effectiveShare ?? 0}%` }} /></span><b>{percent(c.effectiveShare === null ? null : Math.round(c.effectiveShare))}</b>
          </div>
          <div className="ca-campaign-cost"><em className={tone(c.perEffective) || undefined}>{cost(c.perEffective)}</em><small>每个有效</small></div>
        </div>
      )) : <p className="analytics-empty">这段时间没有广告花费，也没有归到广告的客户。</p>)
        : rows.length ? (
          <div role="table" aria-label="广告转化">
            <div className="ca-level-row is-head" role="row"><span role="columnheader">{level === 'adset' ? '广告组' : '广告素材'}</span><span role="columnheader">A/B</span><span role="columnheader">有效</span><span role="columnheader">有效率</span><span role="columnheader">成交</span></div>
            {rows.map(row => (
              <div key={row.key} className="ca-level-row" role="row">
                <span role="cell" title={row.name}>{row.name}</span><span role="cell">{number(row.ab)}</span><strong role="cell">{number(row.effective)}</strong>
                <span role="cell">{percent(row.rate === null ? null : Math.round(row.rate))}</span><span role="cell">{number(row.won)}</span>
              </div>
            ))}
          </div>
        ) : <p className="analytics-empty">这段时间没有归到{level === 'adset' ? '广告组' : '广告素材'}的客户。</p>}
    </>
  );
}
