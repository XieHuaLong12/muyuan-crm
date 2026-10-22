'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUp, Check, Plus, X } from 'lucide-react';
import { Button, Card, EmptyState, Header } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { CATEGORIES } from '@/lib/outreach';
import { IMPROVEMENT_RESULTS, OUTCOMES, REASONS, addDays, type Change, type ImprovementResult, type Outcome, type Reason } from '@/lib/workbench';
import type { ReviewData } from '@/services/daily-review-service';
import { Dots, WorkbenchNav, categoryTag, dayIn, dayTitle, shortDay, timeIn, type Jsonify } from './shared';

type Data = Jsonify<ReviewData>;
type Choice = { itemId: string; outcome: Outcome; reason: Reason | null; note: string };
type Entry = Omit<Data['plan'][number], 'created'> & { key: string };
type Form = { items: Choice[]; lastImprovement: ImprovementResult | null; wins: string; problems: string; improvement: string; energy: number | null; focusLevel: number | null; plan: Entry[] };

const STEPS = [{ n: 1, id: 'review-today', label: '回顾今天' }, { n: 2, id: 'review-questions', label: '复盘三问' }, { n: 3, id: 'review-tomorrow', label: '明日安排' }] as const;
const KINDS: Record<string, string> = { SUBMIT: '提交', EDIT: '修改', REST: '标为休息' };
const entryKey = (p: { itemId: string; fixedKey: string | null; title: string }, index: number) => p.itemId || p.fixedKey || `new-${index}-${p.title}`;
const formOf = (d: Data): Form => ({
  items: d.items.map(i => ({ itemId: i.itemId, outcome: i.outcome, reason: i.reason, note: i.note })),
  lastImprovement: d.lastImprovement as ImprovementResult | null, wins: d.wins, problems: d.problems, improvement: d.improvement, energy: d.energy, focusLevel: d.focusLevel,
  plan: d.plan.map((p, i) => ({ ...p, key: entryKey(p, i) })),
});

/** 每日复盘: look back at today's three things, three questions, and tomorrow's three things. On a phone, one step at a time. */
export function DailyReview({ initial }: { initial: Data }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [form, setFormState] = useState(() => formOf(initial));
  const [focus, setFocus] = useState(initial.focus);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = useRef(false);
  const submitted = data.status === 'SUBMITTED';
  const editable = data.isToday;
  const setForm = (update: (f: Form) => Form) => { dirty.current = true; setFormState(update); };

  const payload = (submit: boolean) => ({ date: data.date, submit, items: form.items, lastImprovement: form.lastImprovement, wins: form.wins, problems: form.problems,
    improvement: form.improvement, energy: form.energy, focusLevel: form.focusLevel,
    plan: form.plan.map(p => ({ itemId: p.itemId || null, fixedKey: p.fixedKey, focusId: p.focusId, href: p.href, title: p.title, category: p.category, startTime: p.startTime, endTime: p.endTime })) });

  async function save(submit: boolean, quiet = false) {
    setSaving(true);
    if (!quiet) { setError(''); setNotice(''); }
    try {
      const result = await api<{ status: string; changes: number }>('workbench/review', 'POST', payload(submit));
      dirty.current = false;
      if (submit && !submitted) { router.push(`/workbench/history?month=${data.date.slice(0, 7)}#day-${data.date}`); return; }
      if (submit) {
        setNotice(result.changes ? `已保存，记下 ${result.changes} 处修改` : '没有改动');
        const next = await api<Data>(`workbench/review?date=${data.date}`);
        setData(next); setFormState(formOf(next)); setFocus(next.focus);
      } else setNotice(`草稿已保存 ${new Intl.DateTimeFormat('zh-CN', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())}`);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  // Drafts save themselves a moment after typing stops; a submitted review is saved on purpose, so each change is one record.
  useEffect(() => {
    if (!dirty.current || !editable || submitted) return;
    const timer = setTimeout(() => { void save(false, true); }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  async function rest() {
    setSaving(true); setError('');
    try { await api('workbench/review/rest', 'POST', { date: data.date }); router.push(data.isToday ? '/workbench' : '/workbench/history'); }
    catch (e) { setError((e as Error).message); setSaving(false); }
  }
  async function stepFocus(id: string, delta: number) {
    setError('');
    try {
      const next = await api<{ currentValue: number; today: number }>(`workbench/focus/${id}/progress`, 'POST', { delta });
      setFocus(list => list.map(f => f.id === id ? { ...f, currentValue: next.currentValue, change: next.today } : f));
    } catch (e) { setError((e as Error).message); }
  }

  function choose(itemId: string, outcome: Outcome) {
    const item = data.items.find(i => i.itemId === itemId)!;
    setForm(f => {
      const items = f.items.map(c => c.itemId === itemId ? { ...c, outcome, reason: outcome === 'DONE' ? null : c.reason } : c);
      let plan = f.plan.filter(p => p.itemId !== itemId);
      if (outcome === 'CARRIED' && plan.length < 8) {
        // What is carried over goes first, after anything else carried from today.
        const at = plan.findIndex(p => !f.items.some(c => c.itemId === p.itemId && c.outcome === 'CARRIED'));
        const entry: Entry = { key: itemId, itemId, fixedKey: null, focusId: null, href: null, title: item.title, category: item.category, focusTitle: item.focusTitle, startTime: null, endTime: null };
        plan = at < 0 ? [...plan, entry] : [...plan.slice(0, at), entry, ...plan.slice(at)];
      }
      return { ...f, items, plan };
    });
  }
  const change = (itemId: string, patch: Partial<Choice>) => setForm(f => ({ ...f, items: f.items.map(c => c.itemId === itemId ? { ...c, ...patch } : c) }));

  const counts = { done: form.items.filter(i => i.outcome === 'DONE').length, carried: form.items.filter(i => i.outcome === 'CARRIED').length, dropped: form.items.filter(i => i.outcome === 'DROPPED').length };
  const summary = [`完成 ${counts.done} / ${form.items.length}`, counts.carried ? `顺延 ${counts.carried}` : '', counts.dropped ? `不做了 ${counts.dropped}` : '',
    editable ? `明天 ${Math.min(form.plan.length, 3)} 件已排好` : ''].filter(Boolean).join(' · ');
  const lastStep = editable || form.plan.length ? 3 : 2;
  const description = editable ? `${dayTitle(data.date)} · ${data.clock} · 回顾今天 → 写三句复盘 → 排好明天三件事，约 3 分钟。${submitted ? '' : '草稿自动保存。'}`
    : `${dayTitle(data.date)} · 补写复盘：当天的结果和明日安排保持原样，可以补原因、复盘三问和评分。`;

  return <div className="bos-wb bos-dr" data-step={step}>
    <Header title="每日复盘" description={description} actions={<WorkbenchNav current="review" />} />
    {submitted && <p className="bos-dr-banner"><Check size={15} aria-hidden="true" />{timeIn(data.submittedAt, data.timezone)} 已提交{data.revisions.length > 1 ? ` · 修改过 ${data.revisions.length - 1} 次` : ''} · 提交后仍可修改，每次修改都会留下记录</p>}
    {data.status === 'MISSED' && <p className="bos-dr-banner is-warning">这天没有复盘，系统按勾选记下了结果。可以补写原因和复盘三问。</p>}
    {data.status === 'REST' && <p className="bos-dr-banner">这天标为休息。想复盘的话，直接填写提交即可。</p>}
    {error && <p className="bos-sales-error" role="alert">{error}</p>}
    <nav className="bos-dr-steps" aria-label="复盘步骤">
      {STEPS.filter(s => s.n <= lastStep).map(s => <a key={s.n} href={`#${s.id}`} aria-current={step === s.n ? 'step' : undefined} onClick={() => setStep(s.n)}><span>{s.n}</span>{s.label}</a>)}
    </nav>

    <Card className="bos-dr-step" data-step={1} id="review-today" aria-label="回顾今天">
      <div className="bos-wb-section-head"><h2>1 · {data.isToday ? '今天' : `${shortDay(data.date)} `}的三件事</h2>
        <small><b>{counts.done} / {form.items.length}</b> 完成{data.others.total ? ` · 其他事项 ${data.others.done} / ${data.others.total}` : ''}</small></div>
      {form.items.length ? <ul className="bos-dr-items">{form.items.map(choice => {
        const item = data.items.find(i => i.itemId === choice.itemId)!;
        const nth = item.carryCount + 1;
        return <li key={choice.itemId} className={`bos-dr-item is-${choice.outcome.toLowerCase()}`}>
          <div className="bos-dr-item-head">
            <span><strong>{item.title}</strong>
              {choice.outcome === 'CARRIED' && nth >= 2 && <small className="is-warning">第 {nth} 次顺延 · 建议拆小，或放到上午</small>}
              {choice.outcome === 'DONE' && item.doneAt && <small>{timeIn(item.doneAt, data.timezone)} 已完成</small>}</span>
            <div role="radiogroup" aria-label={`${item.title}的结果`} className="bos-dr-choice">
              {(Object.keys(OUTCOMES) as Outcome[]).map(o => <button key={o} type="button" role="radio" aria-checked={choice.outcome === o} disabled={!editable}
                className={`is-${o.toLowerCase()}`} onClick={() => choose(choice.itemId, o)}>{OUTCOMES[o]}</button>)}
            </div>
          </div>
          {choice.outcome !== 'DONE' && <div className="bos-dr-reason">
            <span>{choice.outcome === 'DROPPED' ? '为什么不做了' : '没做完的原因'}</span>
            <div className="bos-dr-chips">{(Object.keys(REASONS) as Reason[]).map(r => <button key={r} type="button" aria-pressed={choice.reason === r}
              onClick={() => change(choice.itemId, { reason: choice.reason === r ? null : r })}>{REASONS[r].label}</button>)}</div>
            <label><span>补一句（可不填）</span><input className="bos-input" value={choice.note} maxLength={200} onChange={e => change(choice.itemId, { note: e.target.value })} /></label>
          </div>}
        </li>;
      })}</ul> : <EmptyState title="这天没有排三件事" description="可以直接写复盘三问，并排好明天的三件事。" />}

      <section className="bos-dr-sub" aria-label="当天的数据">
        <div className="bos-wb-section-head"><h3>{data.isToday ? '今天' : '当天'}的数据</h3><small>BOS 自动带出，随复盘一起存档</small></div>
        <div className="bos-dr-tiles">
          <div><span>新线索</span><strong>{data.metrics.leads}</strong><small>企业 {data.metrics.businessLeads}</small></div>
          <div><span>平均首回</span><strong>{data.metrics.firstReplyMinutes === null ? '—' : `${data.metrics.firstReplyMinutes} 分钟`}</strong><small>已首回 {data.metrics.answered} 位</small></div>
          <div><span>客户回复</span><strong>{data.metrics.replies}</strong><small>高意向 {data.metrics.highReplies}</small></div>
          <div><span>发出报价</span><strong>{data.metrics.quotes}</strong><small>本周 {data.metrics.weekQuotes}</small></div>
        </div>
      </section>

      {!!focus.length && <section className="bos-dr-sub" aria-label="本月重心进度">
        <div className="bos-wb-section-head"><h3>本月重心进度</h3><small>{editable ? '只记今天的变化，每次更新都留记录' : '这一天的变化'}</small></div>
        <ul className="bos-dr-focus">{focus.map(f => <li key={f.id}><span>{f.title}</span>
          {f.targetValue ? <span className="bos-dr-stepper">
            {editable && <button type="button" aria-label={`${f.title} 减一`} onClick={() => stepFocus(f.id, -1)} disabled={f.currentValue <= 0}>−</button>}
            <strong>{f.currentValue} / {f.targetValue} {f.unit}</strong>
            {editable && <button type="button" aria-label={`${f.title} 加一`} onClick={() => stepFocus(f.id, 1)}>+</button>}
            {f.change !== 0 && <small>{data.isToday ? '今天' : '当天'} {f.change > 0 ? '+' : ''}{f.change}</small>}
          </span> : <small className="bos-wb-muted">{f.progress}% · <Link href="/workbench#focus">填上目标数</Link>就能每天 +1</small>}</li>)}</ul>
      </section>}
    </Card>

    <Card className="bos-dr-step" data-step={2} id="review-questions" aria-label="复盘三问">
      <h2>2 · 复盘三问</h2>
      {data.previousImprovement && <div className="bos-dr-last">
        <span><small>{data.previousImprovement.date === addDays(data.date, -1) ? '昨天' : shortDay(data.previousImprovement.date)}写下的改进</small>
          <strong>{data.previousImprovement.text}</strong><small>—— {data.isToday ? '今天' : '这天'}做到了吗？</small></span>
        <div role="radiogroup" aria-label="上次的改进做到了吗" className="bos-dr-choice">
          {(Object.keys(IMPROVEMENT_RESULTS) as ImprovementResult[]).map(r => <button key={r} type="button" role="radio" aria-checked={form.lastImprovement === r}
            onClick={() => setForm(f => ({ ...f, lastImprovement: f.lastImprovement === r ? null : r }))}>{IMPROVEMENT_RESULTS[r]}</button>)}
        </div>
      </div>}
      <label className="bos-dr-field"><span>{data.isToday ? '今天' : '这天'}做得好的</span>
        <textarea className="bos-input" rows={2} maxLength={1000} value={form.wins} onChange={e => setForm(f => ({ ...f, wins: e.target.value }))} /></label>
      <label className="bos-dr-field"><span>遇到的问题和原因</span>
        <textarea className="bos-input" rows={2} maxLength={1000} value={form.problems} onChange={e => setForm(f => ({ ...f, problems: e.target.value }))} /></label>
      <label className="bos-dr-field"><span>明天只改进一件事</span>
        <input className="bos-input" maxLength={200} value={form.improvement} onChange={e => setForm(f => ({ ...f, improvement: e.target.value }))} /></label>
      <div className="bos-dr-ratings">
        <Dots label="今天的精力" value={form.energy} onChange={n => setForm(f => ({ ...f, energy: n }))} />
        <Dots label="专注程度" value={form.focusLevel} onChange={n => setForm(f => ({ ...f, focusLevel: n }))} />
      </div>
    </Card>

    {(editable || form.plan.length > 0) && <Tomorrow data={data} form={form} setForm={setForm} editable={editable} />}

    {data.revisions.length > 0 && <Card className="bos-dr-log" aria-label="提交和修改记录">
      <h2>提交和修改记录</h2>
      <ol>{data.revisions.map(r => <li key={r.createdAt}>
        <strong>{dayIn(r.createdAt, data.timezone) === data.date ? '' : `${shortDay(dayIn(r.createdAt, data.timezone))} `}{timeIn(r.createdAt, data.timezone)} {KINDS[r.kind] ?? r.kind}</strong>
        {(r.changes as Change[]).map(c => <span key={c.field}>{c.label}：<del>{c.before}</del> → {c.after}</span>)}
      </li>)}</ol>
    </Card>}

    <div className="bos-dr-bar">
      <span><strong>{summary}</strong><small>{notice || '提交后仍可修改，每次修改都会留下记录'}</small></span>
      <span className="bos-dr-actions">
        {data.status !== 'SUBMITTED' && data.status !== 'REST' && <Button variant="ghost" onClick={rest} disabled={saving}>{data.isToday ? '今天休息' : '这天休息'}</Button>}
        {editable && !submitted && <Button className="bos-dr-desktop" onClick={() => save(false)} disabled={saving}>保存草稿</Button>}
        {step < lastStep && <Button variant="primary" className="bos-dr-mobile" onClick={() => { setStep(step + 1); window.scrollTo({ top: 0 }); }}>下一步 · {STEPS[step].label}</Button>}
        <Button variant="primary" className={step < lastStep ? 'bos-dr-desktop' : ''} onClick={() => save(true)} disabled={saving}>{submitted ? '保存修改' : data.isToday ? '提交复盘' : '提交补写'}</Button>
      </span>
    </div>
  </div>;
}

function Tomorrow({ data, form, setForm, editable }: { data: Data; form: Form; setForm: (update: (f: Form) => Form) => void; editable: boolean }) {
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState({ title: '', category: 'CONVERT' });
  const add = (entry: Omit<Entry, 'key'>) => setForm(f => f.plan.length >= 8 ? f : ({ ...f, plan: [...f.plan, { ...entry, key: entry.itemId || entry.fixedKey || `new-${Date.now()}` }] }));
  const move = (index: number) => setForm(f => { const plan = [...f.plan]; [plan[index - 1], plan[index]] = [plan[index], plan[index - 1]]; return { ...f, plan }; });
  const remove = (key: string) => setForm(f => ({ ...f, plan: f.plan.filter(p => p.key !== key) }));
  const setTime = (key: string, start: string) => {
    const block = data.blocks.find(b => b.startTime === start);
    setForm(f => ({ ...f, plan: f.plan.map(p => p.key === key ? { ...p, startTime: block?.startTime ?? null, endTime: block?.endTime ?? null } : p) }));
  };
  const carriedIds = new Set(form.items.filter(i => i.outcome === 'CARRIED').map(i => i.itemId));
  const planned = (s: Data['suggestions'][number]) => form.plan.some(p => (s.itemId && p.itemId === s.itemId) || (s.fixedKey && p.fixedKey === s.fixedKey) || p.title === s.title);
  const suggestions = data.suggestions.filter(s => !planned(s));
  return <Card className="bos-dr-step" data-step={3} id="review-tomorrow" aria-label="明日安排">
    <div className="bos-wb-section-head"><h2>3 · 明天的三件事</h2><small>{dayTitle(data.tomorrow)} · {editable ? '明早出现在首页' : '当天排好的安排'}</small></div>
    {form.plan.length ? <ol className="bos-dr-plan">{form.plan.map((p, index) => <li key={p.key} className={index >= 3 ? 'is-extra' : ''}>
      <span className="bos-dr-plan-n">{index < 3 ? index + 1 : '·'}</span>
      <span className="bos-dr-plan-body"><strong>{p.title}</strong><span className="bos-wb-meta">
        <span className="bos-chat-tag">{categoryTag(p.category)}</span>
        {carriedIds.has(p.itemId) && <span className="bos-chat-tag is-warning">今天顺延来的</span>}
        {p.fixedKey && <span className="bos-chat-tag is-muted">固定事项</span>}
        {p.focusTitle && <span className="bos-chat-tag is-green">本周重心 · {p.focusTitle}</span>}
        {index >= 3 && <span className="bos-chat-tag is-muted">放进其他事项</span>}
      </span></span>
      {editable ? <>
        {!!data.blocks.length && <label className="bos-dr-slot"><span>时段</span><select value={p.startTime ?? ''} onChange={e => setTime(p.key, e.target.value)}>
          <option value="">不定时段</option>{data.blocks.map(b => <option key={b.startTime} value={b.startTime}>{b.startTime} {b.name}</option>)}</select></label>}
        {index > 0 && <button type="button" className="bos-icon-button" aria-label={`把「${p.title}」往前排`} onClick={() => move(index)}><ArrowUp size={15} /></button>}
        <button type="button" className="bos-icon-button" aria-label={`把「${p.title}」从明天移出`} onClick={() => remove(p.key)}><X size={15} /></button>
      </> : p.startTime && <small className="bos-wb-muted">{p.startTime}</small>}
    </li>)}</ol> : <p className="bos-wb-muted">还没有安排明天的事。从下面挑，或自己写一件。</p>}
    {editable && <div className="bos-dr-suggest">
      <span>也可以从这里挑（超过 3 件会放进「其他事项」）</span>
      <div className="bos-dr-chips">
        {suggestions.map(s => <button key={s.key} type="button" disabled={form.plan.length >= 8}
          onClick={() => add({ itemId: s.itemId ?? '', fixedKey: s.fixedKey, focusId: s.focusId, href: s.href, title: s.title, category: s.category, focusTitle: s.focusId ? s.title : '', startTime: null, endTime: null })}>
          <Plus size={13} aria-hidden="true" />{s.title}<small> · {s.detail}</small></button>)}
        {!writing && <button type="button" onClick={() => setWriting(true)} disabled={form.plan.length >= 8}>自己写一件…</button>}
      </div>
      {writing && <form className="bos-dr-write" onSubmit={e => { e.preventDefault(); if (!draft.title.trim()) return;
        add({ itemId: '', fixedKey: null, focusId: null, href: null, title: draft.title.trim(), category: draft.category, focusTitle: '', startTime: null, endTime: null });
        setDraft({ ...draft, title: '' }); setWriting(false); }}>
        <label><span className="bos-sr-only">明天的事项</span><input className="bos-input" autoFocus maxLength={200} placeholder="明天要做的一件事" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label><span className="bos-sr-only">类别</span><select className="bos-input" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <Button type="submit" variant="primary">加入</Button><Button onClick={() => setWriting(false)}>取消</Button>
      </form>}
    </div>}
  </Card>;
}
