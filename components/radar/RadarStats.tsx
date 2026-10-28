'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Header, Table } from '@/components/ui/bos';
import { api, dateText } from '@/lib/client';
import type { radarStats } from '@/services/radar-analytics-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Data = Jsonify<Awaited<ReturnType<typeof radarStats>>>;
const pct = (value: number | null) => value === null ? '—' : `${value}%`;
const SUGGESTION_TONE: Record<string, 'green' | 'warning' | 'neutral'> = { WIN: 'green', RETIRE: 'warning' };

/**
 * 开发信效果 (docs/CUSTOMER_RADAR_COLD_EMAIL.md, docs/METRICS.md): three numbers a week — the bounce rate and the reply
 * rate decide whether to send more, valid replies whether the project is worth it — then the measure table, template
 * versions compared, and the weekly check of the AI.
 */
export function RadarStats({ data }: { data: Data }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [thisWeek, lastWeek] = data.weeks;
  async function sample(id: string, verdict: 'CORRECT' | 'WRONG') {
    setBusy(true); setError('');
    try { await api(`radar/review/${id}/sample`, 'POST', { verdict }); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const tile = (label: string, value: string, previous: string, goal: string, alarm: boolean) => <Card>
    <span>{label}</span><strong>{value}</strong><small>上周 {previous} · {goal}</small>
    {alarm && <p className="bos-radar-error"><AlertTriangle size={12} aria-hidden="true" /> 超过预警线</p>}
  </Card>;

  return <div className="bos-radar">
    <Header title="开发信效果" description={`本周从 ${dateText(data.week)} 周一算起。退信率、回复率决定能不能加量，有效回复数决定这个项目值不值得继续。没有数据的格子显示「—」。`} />
    {error && <p className="bos-sales-error" role="alert">{error}</p>}
    <div className="bos-outreach-cards bos-radar-tiles">
      {tile('本周退信率', pct(thisWeek.bounceRate), pct(lastWeek.bounceRate), '目标 3% 以下', (thisWeek.bounceRate ?? 0) >= 3)}
      {tile('本周回复率', pct(thisWeek.replyRate), pct(lastWeek.replyRate), '目标 3% 以上', false)}
      {tile('本周有效回复', String(thisWeek.valid), String(lastWeek.valid), '推进 BOS 的回复', false)}
    </div>

    <Card>
      <h2>每周指标</h2>
      <Table caption="开发信每周指标" headings={['周', '新增 A、B 级', '有效邮箱率', '发出', '退信率', '发信客户', '回复率', '有效回复', '回复里的投诉']}>
        {data.weeks.map(w => <tr key={w.week}>
          <td>{dateText(w.week)}</td><td>{w.found}</td><td>{pct(w.mailableRate)}</td><td>{w.sent}</td>
          <td>{pct(w.bounceRate)}{w.bounced > 0 && <small>{w.bounced} 封</small>}</td><td>{w.mailed}</td>
          <td>{pct(w.replyRate)}{w.answered > 0 && <small>{w.answered} 家回复</small>}</td><td>{w.valid}</td><td>{w.complaints}</td>
        </tr>)}
      </Table>
      <p className="bos-radar-hint">回复率 = 本周发出第 1 封的客户里有人回复的比例（不算自动回复和退信，只退信的客户不计入）。「回复里的投诉」只统计回复里明确的投诉；Gmail 用户点「垃圾邮件」的比例看下面的投诉率。</p>
      <div className="bos-radar-spam">
        <strong>Gmail 投诉率（Postmaster Tools）</strong>
        {data.postmaster?.readings.length ? data.postmaster.readings.map(r => <span key={r.domain}>
          {r.domain}：{r.percent === null ? <>—<small>{r.note}</small></> : <>{r.percent}%<small>{dateText(r.day!)} 的数据</small>{r.percent >= 0.1 && <Badge tone="warning">{r.percent >= 0.3 ? '已暂停发信' : '超过 0.1%'}</Badge>}</>}
        </span>) : <span>—<small>每天 08:00 后读一次；连接发信邮箱后才有记录</small></span>}
        <small>超过 0.1% 提醒，达到 0.3% 暂停这个域名的全部发信邮箱。量太小时 Gmail 不出数据。</small>
      </div>
    </Card>

    <div className="bos-outreach-grid is-even">
      <Card>
        <h2>进入 BOS 之后</h2>
        <p className="bos-outreach-big">{data.funnel.pushed} <small>家</small></p>
        <p className="bos-radar-meta">有效回复进入客户库的公司，其中 {data.funnel.advanced} 家已经报价或推进到已报价之后的阶段（上线第 8 周起看）。每个 B 端回复的成本：—（邮箱、验证、服务器费用尚未录入）。</p>
      </Card>
      <Card>
        <h2>回复分类（近 4 周）</h2>
        {data.categories.length ? <ul className="bos-outreach-people">{data.categories.map(c => <li key={c.category}><span>{c.label}</span><strong>{c.count}</strong></li>)}</ul>
          : <p className="bos-radar-hint">还没有回复。</p>}
      </Card>
    </div>

    <Card>
      <h2>模板对比</h2>
      <p className="bos-radar-hint">同一语言、同一封次的版本放在一起比较；每个版本发满 {data.minSample} 封后用胜出概率给建议，只是建议，在「模板」里改状态。人工改过正文的信不计入。</p>
      {data.templates.length ? data.templates.map(g => <div key={`${g.language}-${g.step}`} className="bos-radar-compare">
        <h3>{g.languageLabel} · 第 {g.step} 封</h3>
        <Table caption={`${g.languageLabel}第 ${g.step} 封模板对比`} headings={['编号', '发出（不含退信）', '有回复', '回复率', '有效回复率', '胜出概率', '系统建议']}>
          {g.rows.map(r => <tr key={r.id}>
            <td><strong>{r.code}</strong>{r.status !== 'TESTING' && <small>{r.status === 'WINNER' ? '胜出' : '停用'}</small>}</td>
            <td>{r.sent}{r.bounced > 0 && <small>退信 {r.bounced}</small>}</td><td>{r.replied}</td><td>{pct(r.replyRate)}</td><td>{pct(r.validRate)}</td>
            <td>{r.probability === null ? '—' : `${Math.round(r.probability * 100)}%`}</td>
            <td><Badge tone={SUGGESTION_TONE[r.suggestion] ?? 'neutral'}>{r.suggestionLabel}</Badge></td>
          </tr>)}
        </Table></div>) : <EmptyState title="还没有模板" description="在「模板」里写好第一批模板后，这里按版本比较回复率。" />}
    </Card>

    <Card className="bos-radar-samples">
      <h2>AI 判断准不准 · 本周抽查</h2>
      <p className="bos-outreach-big">{pct(data.ai.accuracy)}</p>
      <p className="bos-radar-meta">本周抽查 {data.ai.checked} 条，判对 {data.ai.correct} 条{data.ai.accuracy !== null && data.ai.accuracy < 90 ? '，低于 90%，请调整回复分析的提示词' : ''}。近 4 周人工复核：确认 {data.ai.reviewedConfirmed} 条、改判 {data.ai.reviewedCorrected} 条。误把有效判成无效会丢客户，重点查这一类。</p>
      <p className="bos-radar-hint">每周人工看 20 条 AI 的判断（有效、无效各一半），判对判错记在这里，用来检查和调整提示词；判错的有效 / 无效到「待复核 · 回复」里改。</p>
      {data.samples.length ? <div className="bos-radar-sample-grid">{data.samples.map(s => <div key={s.id} className="bos-radar-sample">
        <div className="bos-radar-card-head"><strong>{s.prospect}</strong><span><Badge>{s.aiLabel}{s.confidence !== null ? ` · ${Math.round(s.confidence * 100)}%` : ''}</Badge>
          {s.sampleVerdict && <> <Badge tone={s.sampleVerdict === 'CORRECT' ? 'green' : 'warning'}>{s.sampleVerdict === 'CORRECT' ? '判对' : '判错'}</Badge></>}</span></div>
        {s.summary && <p className="bos-radar-meta">{s.summary}</p>}
        <pre className="bos-radar-mail">{s.text || '（正文为空）'}</pre>
        <div className="bos-radar-actions"><Button disabled={busy} onClick={() => sample(s.id, 'CORRECT')}><Check size={14} aria-hidden="true" />判对了</Button>
          <Button variant="ghost" disabled={busy} onClick={() => sample(s.id, 'WRONG')}><X size={14} aria-hidden="true" />判错了</Button></div>
      </div>)}</div> : <p className="bos-radar-hint">最近 7 天没有 AI 判断过的回复。</p>}
    </Card>
  </div>;
}
