'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Sparkles } from 'lucide-react';
import { Header } from '@/components/ui/bos';
import { api } from '@/lib/client';
import type { AiPlan as Data } from '@/services/ai-plan-service';
import { minutesText, money, number } from './AnalyticsParts';

type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
type Plan = Json<Data>;
const GRADE: Record<string, string> = { A: '#c2410c', B: '#1d5fc4' };

/**
 * AI 计划 (docs/METRICS.md §AI 计划): today's timeline (ticked off by itself as the work gets done), last week against
 * the week before, and ad suggestions to adopt or ignore. Nothing here sends a message or changes an ad.
 */
export function AIPlan({ data }: { data: Plan }) {
  const s = data.summary;
  return (
    <div className="business-cockpit bos-analytics plan-page">
      <Header title="今天怎么安排" description={`${data.today} · 你的工作时间 ${data.workText}（${data.timezone === 'Asia/Shanghai' ? '北京' : data.timezone}）· 按进线时间和近 12 周的规律自动排好，事情做完自动打勾`}
        actions={data.clocks.length ? <span className="plan-clocks">{data.clocks.map(c => <span key={c.country}>{c.country} {c.time.split(' ').pop()}</span>)}</span> : undefined} />

      <section className="cc-kpis plan-kpis" aria-label="今天">
        <div className="cc-kpi is-main"><span>工作时间外进线的 A / B</span><strong>{number(s.night)}</strong><small>{s.nightOpen ? `还有 ${s.nightOpen} 位没联系` : s.night ? '都联系过了' : '昨晚没有'}</small></div>
        <div className="cc-kpi"><span>在等你回复</span><strong>{number(s.waiting)}</strong><small>有效客户，最后一条是客户发的</small></div>
        <div className="cc-kpi"><span>今天到期的跟进</span><strong>{number(s.due)}</strong><small>含报价发出 3 天没回音</small></div>
        <div className="cc-kpi"><span>广告建议待确认</span><strong>{number(s.suggestions)}</strong><small>采纳后你去 Meta 后台改</small></div>
      </section>

      <div className="plan-grid">
        <section className="cockpit-card plan-timeline" aria-label="今天的时间线">
          <div className="cc-section-head"><div><h2>今天的时间线</h2><p>按客户那边什么时候在线来排；首条和跟进只给草稿，你点发送才发</p></div>
            <span className="cc-muted">完成 {data.progress.done} / {data.progress.total}</span></div>
          {!!data.waiting.length && <Block title="随时：在等你回复的客户" why="客户刚发来消息，回得越快越好。" time="现在" items={data.waiting} warn />}
          {data.blocks.map(b => <Block key={b.key} title={b.title} why={b.why} time={b.time} local={b.local} items={b.items} note={b.note} now={b.now} gold={b.gold} />)}
          <p className="cc-read">首条消息 AI 只写草稿，你看过、改过再发；报价里的价格、起订量、交期从产品库带出，AI 不编数字。</p>
        </section>

        <div className="plan-side">
          <Week data={data.week} />
          <Suggestions items={data.suggestions} admin={data.admin} />
          <section className="plan-rules" aria-label="规矩">
            <h2>AI 负责算和排，你负责拍板</h2>
            <ul>
              <li>不会自己给客户发消息：首条、跟进、报价都只是草稿，你点了发送才发。</li>
              <li>不会自己改广告：预算、时段、素材的建议，采纳后由你去 Meta 后台改。</li>
              <li>每条结论都写依据和样本数；一组不到 20 位客户的规律不出建议。</li>
              <li>价格、起订量、交期只从产品库来。</li>
              <li>你点的「采纳 / 忽略」会记下来，采纳的 7 天后自动复盘。</li>
            </ul>
          </section>
          {data.admin && <WorkHours start={data.hours.start} end={data.hours.end} />}
        </div>
      </div>
    </div>
  );
}

type Item = Plan['waiting'][number];
function Block({ title, why, time, local, items, note, now, gold, warn }: { title: string; why: string; time: string; local?: string; items: Item[]; note?: string; now?: boolean; gold?: boolean; warn?: boolean }) {
  return (
    <div className="plan-block">
      <div className="plan-time"><strong>{time}</strong>{local && <small>{local}</small>}</div>
      <div className={`plan-box${now ? ' is-now' : gold ? ' is-gold' : warn ? ' is-warn' : ''}`}>
        <div className="plan-box-head">{now && <span className="plan-badge is-now">现在</span>}{gold && <span className="plan-badge is-gold">黄金时段</span>}<strong>{title}</strong></div>
        <span className="plan-why">{why}</span>
        {items.map(t => <Link key={t.key} href={t.href} className={`plan-item${t.done ? ' is-done' : ''}`}>
          <span className={`plan-check${t.done ? ' is-done' : ''}`} aria-label={t.done ? '已完成' : '未完成'}>{t.done && <Check size={12} aria-hidden />}</span>
          {t.grade && GRADE[t.grade] && <span className="plan-grade" style={{ background: GRADE[t.grade] }}>{t.grade}</span>}
          <span className="plan-item-text"><b>{t.title}</b><small>{t.meta}</small></span>
          {t.wait && !t.done && <em className="plan-wait">{t.wait}</em>}
        </Link>)}
        {note && <span className="plan-note">{note}</span>}
      </div>
    </div>
  );
}

function Week({ data }: { data: Plan['week'] }) {
  const cur = data.last.currency;
  const delta = (a: number | null, b: number | null, lowerIsBetter = false, unit = '') => {
    if (a === null || b === null) return { text: '上周没数据', tone: '' };
    const d = Math.round((a - b) * 10) / 10;
    if (!d) return { text: '持平', tone: '' };
    return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)}${unit} · 前一周 ${b}${unit}`, tone: (d > 0) !== lowerIsBetter ? 'is-up' : 'is-down' };
  };
  const rows = [
    { label: '有效客户', value: `${data.last.effective} 位`, ...delta(data.last.effective, data.before.effective, false, ' 位'),
      why: data.mover ? `变化最大的是${data.mover.country}（${data.mover.delta > 0 ? '+' : ''}${data.mover.delta} 位）。A / B 线索 ${data.last.ab} 位，前一周 ${data.before.ab} 位。` : `A / B 线索 ${data.last.ab} 位，前一周 ${data.before.ab} 位。` },
    { label: '每个有效客户', value: data.last.perEffective === null ? '—' : money(data.last.perEffective, cur), ...delta(data.last.perEffective, data.before.perEffective, true),
      why: data.last.spend === null ? '这周还没有广告花费数据。' : `广告花费 ${money(data.last.spend, cur)}${data.before.spend !== null ? `，前一周 ${money(data.before.spend, cur)}` : ''}。` },
    { label: '首联用时（A / B）', value: minutesText(data.last.contact), ...delta(data.last.contact, data.before.contact, true, ' 分钟'),
      why: data.last.offShare === null ? '这周没有带钟点的进线。' : `${data.last.offShare}% 的进线在你的工作时间外，这部分要等到第二天，最拖慢首联。` },
  ];
  return (
    <section className="cockpit-card plan-week" aria-label="周报">
      <div className="cc-findings-head"><span className="cc-spark" aria-hidden><Sparkles size={17} /></span><div><h2>周报 · {data.label}</h2><p>和前一周比 · 按进线时间</p></div></div>
      {rows.map(r => <div key={r.label} className="plan-week-row">
        <div><span>{r.label}</span><strong>{r.value}</strong><em className={r.tone}>{r.text}</em></div>
        <p>{r.why}</p>
      </div>)}
    </section>
  );
}

const TAG: Record<string, [string, string]> = { WEEKDAY_BUDGET: ['星期', 'is-day'], DAYPART: ['时段', 'is-send'], CREATIVE: ['素材', 'is-entry'] };
function Suggestions({ items, admin }: { items: Plan['suggestions']; admin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  async function decide(id: string, status: 'ADOPTED' | 'IGNORED' | 'PENDING') {
    setBusy(id); setError('');
    try { await api('insights/suggestions', 'POST', { id, status }); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  return (
    <section className="cockpit-card plan-ads" id="ads" aria-label="广告预算建议">
      <div className="cc-section-head"><div><h2>广告预算建议</h2><p>按「每个有效客户花多少钱」和进线时间算 · 采纳后你去 Meta 后台改，7 天后自动复盘</p></div></div>
      {error && <p className="bos-chat-error" role="alert">{error}</p>}
      {!items.length && <p className="cc-muted">这周没有足够把握的建议（每组至少 20 位客户才会出）。</p>}
      {items.map(s => <article key={s.id} className={`plan-idea is-${s.status.toLowerCase()}`}>
        <div className="plan-idea-head"><span className={`cc-tag ${TAG[s.kind]?.[1] ?? ''}`}>{TAG[s.kind]?.[0] ?? s.kind}</span><strong>{s.title}</strong></div>
        <p>{s.body}</p>
        {s.review && <p className="plan-review"><b>复盘：{s.review.verdict}</b> · 有效率 {s.review.before.rate ?? '—'}% → {s.review.after.rate ?? '—'}%{s.review.before.cost !== null || s.review.after.cost !== null ? ` · 每个有效 ${s.review.before.cost ?? '—'} → ${s.review.after.cost ?? '—'}` : ''}（A/B {s.review.beforeAb} → {s.review.afterAb} 位）</p>}
        <div className="plan-idea-foot">
          <small>{s.basis}</small>
          {admin && (s.status === 'PENDING'
            ? <span className="plan-idea-buttons"><button type="button" disabled={busy === s.id} onClick={() => void decide(s.id, 'IGNORED')}>忽略</button><button type="button" className="is-primary" disabled={busy === s.id} onClick={() => void decide(s.id, 'ADOPTED')}>采纳</button></span>
            : <span className="plan-idea-state">{s.status === 'ADOPTED' ? `已采纳${s.reviewAt && !s.review ? ` · ${s.reviewAt.slice(5, 10)} 复盘` : ''}` : '已忽略'}<button type="button" className="bos-chat-link" disabled={busy === s.id} onClick={() => void decide(s.id, 'PENDING')}>撤回</button></span>)}
        </div>
      </article>)}
    </section>
  );
}

function WorkHours({ start, end }: { start: number; end: number }) {
  const router = useRouter();
  const [from, setFrom] = useState(start), [to, setTo] = useState(end), [state, setState] = useState('');
  async function save() {
    setState('saving');
    try { await api('insights/work-hours', 'PATCH', { start: from, end: to }); setState('saved'); router.refresh(); } catch (e) { setState((e as Error).message); }
  }
  return (
    <section className="cockpit-card plan-hours" aria-label="工作时间">
      <h2 className="cc-h3">你的工作时间</h2>
      <p className="cc-muted">进线时间判断「工作时间外」、热力图的工作时段、今天的安排都按它来。</p>
      <div className="plan-hours-row">
        <label>上班<select value={from} onChange={e => setFrom(Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
        <label>下班<select value={to} onChange={e => setTo(Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => h + 1).map(h => <option key={h} value={h}>{h}:00</option>)}</select></label>
        <button type="button" className="cc-primary" disabled={state === 'saving' || from >= to || (from === start && to === end)} onClick={() => void save()}>保存</button>
      </div>
      {state && state !== 'saving' && <small className={state === 'saved' ? 'cc-muted' : 'bos-chat-error'}>{state === 'saved' ? '已保存' : state}</small>}
    </section>
  );
}
