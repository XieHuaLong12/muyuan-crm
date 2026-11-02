'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { CustomerJourney } from '@/services/entry-time-service';

/**
 * 进线时间 and 从进线到现在 (docs/METRICS.md §进线时间): when the lead came in — company time and the customer's
 * own — whether that was outside the working hours, and each step after with how long it took. Read only.
 */
export function Journey({ customerId, revision = 0 }: { customerId: string; revision?: number }) {
  const [data, setData] = useState<CustomerJourney>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    api<CustomerJourney>(`insights/journey?customerId=${encodeURIComponent(customerId)}`).then(d => { if (live) setData(d); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [customerId, revision]);
  if (error) return <p className="journey-note">{error}</p>;
  if (!data) return <p className="journey-note">正在读取进线时间…</p>;
  const { entry } = data;
  const companyZone = data.timezone === 'Asia/Shanghai' ? '北京' : data.timezone;
  return (
    <div className="journey">
      <div className="journey-entry">
        <span className="journey-entry-title">进线时间 · {entry.channelLabel}</span>
        <div className="journey-clocks">
          <div><span>{companyZone}</span><strong>{entry.company}</strong></div>
          {entry.local && <div><span>{entry.local.country || '客户当地'}（{entry.local.offset}）</span><strong>{entry.local.label}</strong></div>}
        </div>
        <span className={`journey-badge${entry.estimated ? ' is-estimated' : entry.offHours ? ' is-off' : ''}`}>
          {entry.estimated ? '估算' : !entry.exact ? '只有日期' : entry.offHours ? `工作时间外进线 · 你 ${data.hours.start}:00 上班后才看到` : '工作时间内进线'}
        </span>
        <span className="journey-note">{entry.source}</span>
      </div>
      <ol className="journey-steps" aria-label="从进线到现在">
        {data.steps.map((s, i) => (
          <li key={`${s.title}-${i}`} className={`journey-step${s.open ? ' is-open' : ''}`}>
            <span className="journey-rail" aria-hidden><i /><b /></span>
            <span className="journey-body"><strong>{s.title}</strong><span>{s.detail}</span></span>
            <span className="journey-when">{s.label}{s.gap && <em className={`journey-gap is-${s.tone ?? 'plain'}`}>{s.gap}</em>}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
