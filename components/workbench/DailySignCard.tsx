'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';
import type { DailySignView } from '@/services/daily-sign-service';

const CAPS = ['#c0392b', '#e8c36a', '#c0392b', '#e8c36a', '#c0392b', '#e8c36a', '#c0392b', '#e8c36a', '#c0392b'];
const SPOTS = [[14, 116], [58, 128], [102, 126], [142, 110], [34, 80], [78, 88], [120, 74], [54, 44], [96, 40]];

/**
 * 每日一签 at the top of the work calendar (docs/IDEA_WALL.md §每日一签): pick what to ask, turn the handle, read the
 * sign (an original poem, its reading, luck, 宜 / 忌 from today's data, a line from my wall). Once a day; only good
 * signs. Folded into a strip after 收下; from half an hour before the end of work, today's numbers say whether it
 * came true.
 */
export function DailySignCard() {
  const [data, setData] = useState<DailySignView>();
  const [topic, setTopic] = useState('DEAL');
  const [turns, setTurns] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { api<DailySignView>('daily-sign').then(setData).catch(e => setError((e as Error).message)); }, []);
  async function call(method: 'POST' | 'PATCH', body: object) {
    setBusy(true); setError('');
    try { setData(await api<DailySignView>('daily-sign', method, body)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!data) return error ? <p className="bos-sales-error" role="alert">{error}</p> : null;
  const sign = data.sign, c = sign?.content;
  const topicName = (key: string) => data.topics.find(t => t.key === key)?.label ?? key;

  // 晚上：对签
  if (sign && data.canCheck) return (
    <section className="ds-night" aria-label="今天的签灵不灵">
      <span className="ds-seal is-night">{sign.verdict === 'YES' ? '应验' : sign.verdict === 'NO' ? '明日' : '对签'}</span>
      <span className="ds-night-body">
        <small>{data.checkAt} 以后 · 今天的签灵不灵？</small>
        <b>早上问「{topicName(sign.topic)}」，签上说：{c!.read.split('。')[0]}。</b>
        <span>今天：<em>{data.check}</em></span>
      </span>
      <span className="ds-night-actions">
        <button type="button" aria-pressed={sign.verdict === 'YES'} disabled={busy} onClick={() => void call('PATCH', { action: 'verdict', verdict: 'YES' })}>👍 灵</button>
        <button type="button" aria-pressed={sign.verdict === 'NO'} disabled={busy} onClick={() => void call('PATCH', { action: 'verdict', verdict: 'NO' })}>😅 不太灵</button>
      </span>
      <Week data={data} />
    </section>
  );

  // 收下以后：一条
  if (sign && sign.collected) return (
    <section className="ds-strip" aria-label="今日一签">
      <span className="ds-seal is-small">{c!.grade}</span>
      <span className="ds-strip-body">
        <b>「{c!.poem[0]}，{c!.poem[1]}。」</b>
        <small>问{topicName(sign.topic)} · 宜 {c!.yi[0]} · 吉时 {c!.charms.hours} · 贵人在{c!.charms.direction}</small>
      </span>
      <small className="ds-strip-later">{data.checkAt} 以后回来看看灵不灵</small>
      <button type="button" disabled={busy} onClick={() => void call('PATCH', { action: 'reopen' })}>再看一眼</button>
    </section>
  );

  const asking = !sign;
  return (
    <section className="ds-hero" aria-label="今日一签">
      <div className="ds-left">
        <small className="ds-date">{data.today} · 每天一签</small>
        <h2>今日一签</h2>
        <p>先想好今天最想问的一件事，心里默念一遍，再转把手。只有吉签。</p>
        <small className="ds-label">今天想问</small>
        <span className="ds-topics" role="radiogroup" aria-label="今天想问">
          {data.topics.map(t => <button key={t.key} type="button" role="radio" aria-checked={(sign?.topic ?? topic) === t.key} disabled={!asking}
            onClick={() => setTopic(t.key)}>{t.icon} {t.label}</button>)}
        </span>
        <div className="ds-machine">
          <div className="ds-dome" aria-hidden>
            <div className="ds-pile" style={{ animation: turns ? `${turns % 2 ? 'ds-shake' : 'ds-shake2'} .7s ease-in-out` : undefined }}>
              {SPOTS.map(([x, y], i) => <span key={i} className="ds-cap" style={{ left: x, top: y, animationDelay: `-${(i * 0.41).toFixed(2)}s` }}><i style={{ background: CAPS[i] }} /><b>签</b></span>)}
            </div>
          </div>
          <div className="ds-body" aria-hidden>
            <span>求 签</span>
            <span className="ds-out">{sign && <i className="ds-out-cap" />}</span>
          </div>
          <span className="ds-crank-wrap">
            <button type="button" className={`ds-crank${asking ? ' is-ready' : ''}`} style={{ transform: `rotate(${turns * 360}deg)` }} disabled={!asking || busy}
              aria-label={asking ? `问「${topicName(topic)}」，转把手求签` : '今天已经求过了'}
              onClick={() => { setTurns(turns + 1); void call('POST', { topic }); }}><i /><b /></button>
            <small>{asking ? `问「${topicName(topic)}」· 转一下` : '今天已经求过了'}</small>
          </span>
        </div>
        <small className="ds-streak">🔥 连续 <b>{data.streak}</b> 天求签 · 本月应验 <b>{data.cameTrue}</b> 次{data.remindersDue ? <> · <Link href="/ideas">想法墙有 {data.remindersDue} 张纸条到日子了</Link></> : null}</small>
      </div>

      <div className="ds-right">
        {error && <p className="bos-sales-error" role="alert">{error}</p>}
        {!c ? <div className="ds-wait"><b>心诚则灵</b><small>问「{topicName(topic)}」· 转左边的把手 ↻</small></div> : (
          <article className="ds-slip">
            <div className="ds-slip-main">
              <small className="ds-no">第{c.noText}签 · 问{topicName(c.topic)} · {c.grade}</small>
              <div className="ds-read"><b>解签</b><p>{c.read}</p></div>
              <div className="ds-stars">{c.stars.map(s => <span key={s.label}><i>{s.label}</i><b className={s.stars === 5 ? 'is-full' : ''}>{'★'.repeat(s.stars)}{'☆'.repeat(5 - s.stars)}</b></span>)}</div>
              <div className="ds-charms">
                <span><small>幸运色</small><b>{c.charms.color}</b></span><span><small>幸运数字</small><b>{c.charms.number}</b></span>
                <span><small>吉时</small><b>{c.charms.hours}</b></span><span><small>贵人方位</small><b>{c.charms.direction}</b></span>
              </div>
              <div className="ds-yiji">
                <span><b className="is-yi">宜</b>{c.yi.map(y => <i key={y}>{y}</i>)}</span>
                <span><b className="is-ji">忌</b>{c.ji.map(j => <i key={j}>{j}</i>)}</span>
              </div>
              <small className="ds-gift">今日赠言：<q>{c.gift.text}</q> —— {c.gift.source}</small>
              <span className="ds-actions">
                <button type="button" className="is-primary" disabled={busy} onClick={() => void call('PATCH', { action: 'collect' })}>收下这一签，开始今天 →</button>
                <Link href="/ideas">去想法墙</Link>
              </span>
            </div>
            <div className="ds-slip-poem">
              <span className="ds-seal">{c.grade}</span>
              <p className="ds-poem" aria-label={`${c.poem.join('，')}。`}>{c.poem.map((line, i) => <span key={i} aria-hidden>{line}{i % 2 ? '。' : '，'}</span>)}</p>
            </div>
          </article>
        )}
        <Week data={data} />
      </div>
    </section>
  );
}

function Week({ data }: { data: DailySignView }) {
  return (
    <div className="ds-week" aria-label="这周的签册">
      <b>这周的签册</b>
      {data.week.map(d => <span key={d.day} className={`${d.today ? 'is-today' : ''}${d.future ? ' is-future' : ''}`}>
        <small>{d.label}</small><i className={d.grade ? 'is-drawn' : ''}>{d.grade || '·'}</i><em className={d.verdict === 'YES' ? 'is-yes' : ''}>{d.verdict === 'YES' ? '灵 ✓' : d.verdict === 'NO' ? '还行' : d.today ? '今天' : ' '}</em>
      </span>)}
      {data.weekLine && <p>{data.weekLine}</p>}
    </div>
  );
}
