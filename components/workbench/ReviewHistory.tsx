'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Search as SearchIcon } from 'lucide-react';
import { Card, EmptyState, Header } from '@/components/ui/bos';
import { IMPROVEMENT_RESULTS, OUTCOMES, REASONS, addDays, type Change, type ImprovementResult } from '@/lib/workbench';
import type { HistoryData } from '@/services/daily-review-service';
import { WorkbenchNav, categoryTag, dayIn, shortDay, timeIn, weekdayOf, type Jsonify } from './shared';

type Data = Jsonify<HistoryData>;
type Entry = Data['journal'][number];
const KINDS: Record<string, string> = { SUBMIT: '提交', EDIT: '修改', REST: '标为休息' };
const monthLabel = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
const points = (now: number | null, before: number | null, unit: string, lowerIsBetter = false) => {
  if (now === null || before === null) return '上月没有记录';
  const diff = Math.round((now - before) * 10) / 10;
  if (!diff) return '和上月持平';
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return <span className={better ? 'is-better' : 'is-worse'}>比上月 {diff > 0 ? '↑' : '↓'} {Math.abs(diff)} {unit}</span>;
};

/** 复盘记录: every day's review, tomorrow's plan and every change, with the month at a glance. Only the author sees it. */
export function ReviewHistory({ data }: { data: Data }) {
  const router = useRouter();
  const [q, setQ] = useState(data.q);
  const go = (params: Record<string, string>) => router.push(`/workbench/history?${new URLSearchParams(params)}`);
  const s = data.stats;
  const improvementRate = s.improvement.total ? Math.round(s.improvement.yes / s.improvement.total * 100) : null;
  const backfillFrom = addDays(data.today, -30);
  return <div className="bos-wb bos-rec">
    <Header title="复盘记录" description="每天的三件事、复盘、明日安排和提交后的每次修改都按天留存，只有你自己能看。" actions={<>
      <div className="bos-rec-month" role="group" aria-label="选择月份">
        <button type="button" className="bos-icon-button" aria-label="上个月" onClick={() => go({ month: data.prevMonth })}><ChevronLeft size={16} /></button>
        <strong>{monthLabel(data.month)}</strong>
        <button type="button" className="bos-icon-button" aria-label="下个月" disabled={data.nextMonth > data.today.slice(0, 7)} onClick={() => go({ month: data.nextMonth })}><ChevronRight size={16} /></button>
      </div>
      <WorkbenchNav current="history" />
    </>} />

    <section className="bos-rec-stats" aria-label={`${monthLabel(data.month)}概况`}>
      <Card><span>连续复盘</span><strong className="is-green">{s.streak.current}<small> 天</small></strong><small>最长 {s.streak.longest} 天</small></Card>
      <Card><span>三件事完成率</span><strong>{s.rate === null ? '—' : `${s.rate}%`}</strong><small>{points(s.rate, s.prevRate, '个百分点')}</small></Card>
      <Card><span>平均每天顺延</span><strong>{s.carriedPerDay === null ? '—' : s.carriedPerDay}<small> 件</small></strong><small>{points(s.carriedPerDay, s.prevCarriedPerDay, '件', true)}</small></Card>
      <Card><span>改进做到率</span><strong>{improvementRate === null ? '—' : `${improvementRate}%`}</strong>
        <small>{s.improvement.total ? `${s.improvement.total} 次里做到 ${s.improvement.yes} 次${s.improvement.partly ? `，部分 ${s.improvement.partly} 次` : ''}` : '复盘时会问上次的改进做到没有'}</small></Card>
    </section>

    <div className="bos-wb-main">
      <div className="bos-rec-col">
        <Card className="bos-rec-calendar" aria-label={`${monthLabel(data.month)}每日完成情况`}>
          <div className="bos-wb-section-head"><h2>{Number(data.month.slice(5))} 月</h2>
            <span className="bos-rec-legend" aria-hidden="true"><i className="is-full" />全部完成<i className="is-mid" />完成过半<i className="is-low" />完成不到一半<i className="is-missed" />没复盘<i className="is-rest" />休息</span></div>
          <div className="bos-rec-grid">
            {['一', '二', '三', '四', '五', '六', '日'].map(d => <span key={d} className="bos-rec-head" aria-hidden="true">{d}</span>)}
            {data.days.map(d => {
              const ratio = d.planned ? d.done / d.planned : null;
              const tone = d.status === 'REST' ? 'is-rest' : ratio === null ? '' : ratio === 1 ? 'is-full' : ratio >= 0.5 ? 'is-mid' : 'is-low';
              const label = `${d.key}：${d.status === 'REST' ? '休息' : d.planned ? `完成 ${d.done}/${d.planned}` : '没有三件事'}${d.status === 'MISSED' ? '，没复盘' : d.status === 'SUBMITTED' ? '，已复盘' : ''}`;
              const className = `bos-rec-day ${tone}${d.status === 'MISSED' || d.status === 'DRAFT' ? ' is-missed' : ''}${d.today ? ' is-today' : ''}${d.inMonth ? '' : ' is-out'}`;
              const body = <><span>{Number(d.key.slice(8))}</span>{d.status === 'REST' ? <small>休</small> : d.planned ? <small>{d.done}/{d.planned}</small> : null}</>;
              if (d.future || !d.inMonth) return <span key={d.key} className={`${className} is-future`} aria-hidden={!d.inMonth || undefined}>{body}</span>;
              const hasEntry = data.journal.some(j => j.date === d.key);
              const href = hasEntry ? `#day-${d.key}` : d.key >= backfillFrom ? `/workbench/review?date=${d.key}` : undefined;
              return href ? <Link key={d.key} href={href} className={className} aria-label={label}>{body}</Link> : <span key={d.key} className={className} aria-label={label}>{body}</span>;
            })}
          </div>
          <small className="bos-wb-muted">周末也计入完成率；标为休息的日子不计入，也不打断连续复盘。点一天查看那天的复盘，没复盘的 30 天内可以补写。</small>
        </Card>

        <Card className="bos-rec-journal" aria-label="每日复盘">
          <div className="bos-wb-section-head"><h2>{data.q ? `搜索「${data.q}」` : '每日复盘'}</h2>
            <form role="search" onSubmit={e => { e.preventDefault(); go(q.trim() ? { month: data.month, q: q.trim() } : { month: data.month }); }} className="bos-rec-search">
              <SearchIcon size={15} aria-hidden="true" /><input type="search" aria-label="搜索复盘内容" placeholder="搜索复盘内容" value={q} maxLength={50} onChange={e => setQ(e.target.value)} />
            </form></div>
          {data.journal.length ? data.journal.map(entry => <JournalEntry key={entry.date} entry={entry} data={data} canBackfill={entry.date >= backfillFrom} />)
            : <EmptyState title={data.q ? '没有找到' : '这个月还没有复盘'} description={data.q ? '换个词试试，搜索的是做得好的、问题和改进。' : '每晚复盘后，这里按天留下记录。'} />}
          {!data.q && data.month <= data.today.slice(0, 7) && <button type="button" className="bos-rec-more" onClick={() => go({ month: data.prevMonth })}>查看 {monthLabel(data.prevMonth)}</button>}
        </Card>
      </div>

      <aside className="bos-wb-side">
        <Card className="bos-rec-side" aria-label="没做完的原因">
          <h2>没做完的原因 · {Number(data.month.slice(5))} 月</h2>
          {data.reasons.length ? <>
            <ul className="bos-rec-bars">{data.reasons.map(r => <li key={r.key}><span>{r.label}</span>
              <span className="bos-wb-bar" role="img" aria-label={`${r.label} ${r.count} 次`}><i style={{ width: `${r.count / data.reasons[0].count * 100}%` }} /></span><span>{r.count}</span></li>)}</ul>
            {data.reasons[0].advice && <p className="bos-rec-tip">「{data.reasons[0].label}」最多：{data.reasons[0].advice}</p>}
          </> : <p className="bos-wb-muted">复盘时选的原因会汇总在这里。</p>}
        </Card>

        <Card className="bos-rec-side" aria-label="改进清单">
          <h2>改进清单</h2>
          {data.improvements.length ? <ul className="bos-rec-improvements">{data.improvements.map(i => <li key={i.date}><span><small>{shortDay(i.date)}</small>{i.text}</span>
            <b className={i.result ? `is-${i.result.toLowerCase()}` : ''}>{i.result ? IMPROVEMENT_RESULTS[i.result as ImprovementResult] : '下次复盘看'}</b></li>)}</ul>
            : <p className="bos-wb-muted">每次复盘写下的「明天只改进一件事」和做到没有。</p>}
        </Card>

        <Card className="bos-rec-side" aria-label="重心进度变化">
          <h2>重心进度变化</h2>
          {data.progress.length ? data.progress.map(f => <div key={f.id} className="bos-rec-focus">
            <strong>{f.title} · {f.targetValue ? `${f.currentValue} / ${f.targetValue} ${f.unit}` : `${f.progress}%`}</strong>
            {f.points.length ? <div className="bos-rec-steps" role="img" aria-label={`${f.title}：${f.points.map(p => `${shortDay(p.date)} ${p.value}`).join('，')}`}>
              {f.points.slice(-8).map(p => <span key={p.date}><i style={{ height: `${Math.max(8, Math.min(100, p.value / (f.targetValue || 100) * 100))}%` }} /><small>{shortDay(p.date)}</small></span>)}
            </div> : <small className="bos-wb-muted">还没有更新记录</small>}
          </div>) : <p className="bos-wb-muted">这个月没有设定重心。</p>}
          <small className="bos-wb-muted">每次更新进度都记一笔：哪天、从多少到多少。</small>
        </Card>

        <Card className="bos-rec-side" aria-label="精力分配">
          <h2>精力分配 · {Number(data.month.slice(5))} 月</h2>
          <p className="bos-wb-muted">{data.energy.total ? `完成 ${data.energy.total} 项，按类别统计` : '这个月还没有完成的事项'}；对照 {data.energy.rows.map(r => `${r.target}%`).join(' / ')}。</p>
          <ul className="bos-rec-bars">{data.energy.rows.map(r => <li key={r.key}><span>{r.label}</span>
            <span className="bos-wb-bar" role="img" aria-label={`${r.label} ${r.share ?? 0}%，目标 ${r.target}%`}><i style={{ width: `${r.share ?? 0}%` }} /><b style={{ left: `${r.target}%` }} /></span>
            <span>{r.share === null ? '—' : `${r.share}%`}</span></li>)}</ul>
        </Card>
      </aside>
    </div>
  </div>;
}

function JournalEntry({ entry, data, canBackfill }: { entry: Entry; data: Data; canBackfill: boolean }) {
  const today = entry.date === data.today;
  const head = <div className="bos-rec-date"><strong>{shortDay(entry.date)}</strong><span>{weekdayOf(entry.date)}{today ? ' · 今天' : ''}</span></div>;
  if (entry.status === 'REST') return <article id={`day-${entry.date}`} className="bos-rec-entry">{head}<p className="bos-wb-muted">休息</p></article>;
  const edits = entry.revisions.filter(r => r.kind === 'EDIT');
  return <article id={`day-${entry.date}`} className="bos-rec-entry">
    {head}
    <div className="bos-rec-body">
      {entry.status !== 'SUBMITTED' && <div className="bos-rec-missed">
        <span>{today ? '今天还没复盘' : '这天没有复盘'}{entry.planned ? ` · 三件事完成 ${entry.done}/${entry.planned}（系统按勾选记录）` : ''}</span>
        {canBackfill && <Link href={`/workbench/review${today ? '' : `?date=${entry.date}`}`}>{today ? '去复盘' : '补写复盘'}</Link>}
      </div>}
      {entry.status === 'SUBMITTED' && <div className="bos-wb-meta">
        <span className={`bos-chat-tag ${entry.planned && entry.done === entry.planned ? 'is-green' : ''}`}>完成 {entry.done}/{entry.planned}</span>
        {!!entry.carried && <span className="bos-chat-tag is-warning">顺延 {entry.carried}</span>}
        {!!entry.dropped && <span className="bos-chat-tag is-muted">不做了 {entry.dropped}</span>}
        {(entry.energy || entry.focusLevel) && <span className="bos-chat-tag is-muted">精力 {entry.energy ?? '—'} · 专注 {entry.focusLevel ?? '—'}</span>}
        {entry.focusChanges.map((c, i) => <span key={i} className="bos-chat-tag is-muted">{c.title} {c.from} → {c.to}{c.target ? ` / ${c.target} ${c.unit}` : '%'}</span>)}
        {entry.late && <span className="bos-chat-tag is-muted">补写</span>}
      </div>}
      {!!entry.items.length && <ul className="bos-rec-items">{entry.items.map(i => <li key={i.itemId} className={`is-${i.outcome.toLowerCase()}`}>
        <b>{i.outcome === 'DONE' ? '✓' : i.outcome === 'CARRIED' ? '→' : '×'}</b>
        <span>{i.title}<small> · {categoryTag(i.category)}{i.outcome !== 'DONE' ? ` · ${OUTCOMES[i.outcome]}${i.reason ? ` · ${REASONS[i.reason].label}` : ''}${i.note ? ` · ${i.note}` : ''}` : ''}</small></span>
      </li>)}</ul>}
      {(entry.wins || entry.problems || entry.improvement || entry.lastImprovement) && <dl className="bos-rec-answers">
        {entry.lastImprovement && entry.previousImprovement && <><dt>上次改进</dt><dd>{entry.previousImprovement} · <b>{IMPROVEMENT_RESULTS[entry.lastImprovement as ImprovementResult]}</b></dd></>}
        {entry.wins && <><dt>做得好</dt><dd>{entry.wins}</dd></>}
        {entry.problems && <><dt>问题</dt><dd>{entry.problems}</dd></>}
        {entry.improvement && <><dt>改进</dt><dd><strong>{entry.improvement}</strong></dd></>}
      </dl>}
      {!!entry.plan.length && <div className="bos-rec-plan"><span>排好的明天</span><ol>{entry.plan.map((p, i) => <li key={p.itemId || i} className={i >= 3 ? 'is-extra' : ''}>{p.title}{p.startTime ? <small> · {p.startTime}</small> : null}</li>)}</ol></div>}
      {entry.metrics && entry.status === 'SUBMITTED' && <small className="bos-wb-muted">当天：新线索 {entry.metrics.leads} · 平均首回 {entry.metrics.firstReplyMinutes === null ? '—' : `${entry.metrics.firstReplyMinutes} 分钟`} · 客户回复 {entry.metrics.replies} · 报价 {entry.metrics.quotes}</small>}
      {entry.submittedAt && <details className="bos-rec-revisions">
        <summary>{entry.late ? `${shortDay(dayIn(entry.submittedAt, data.timezone))} ` : ''}{timeIn(entry.submittedAt, data.timezone)} 提交 · {edits.length ? `修改过 ${edits.length} 次` : '没有修改'}</summary>
        <ol>{entry.revisions.map(r => <li key={r.createdAt}><strong>{dayIn(r.createdAt, data.timezone) === entry.date ? '' : `${shortDay(dayIn(r.createdAt, data.timezone))} `}{timeIn(r.createdAt, data.timezone)} {KINDS[r.kind] ?? r.kind}</strong>
          {(r.changes as Change[]).map(c => <span key={c.field}>{c.label}：<del>{c.before}</del> → {c.after}</span>)}</li>)}</ol>
      </details>}
    </div>
  </article>;
}
