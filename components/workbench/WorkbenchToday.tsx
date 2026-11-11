'use client';
import { useCallback, useEffect, useState } from 'react';
import { DailySignCard } from './DailySignCard';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, Clock, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, Header } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { CATEGORIES } from '@/lib/outreach';
import { addDays, blockName } from '@/lib/workbench';
import type { WorkbenchData } from '@/services/workbench-service';
import { WorkbenchNav, categoryTag, dayTitle, shortDay, timeIn, zoneLabel, type Jsonify } from './shared';

type Data = Jsonify<WorkbenchData>;
type Item = Data['three'][number];
type Focus = Data['focus'];
type Act = (run: () => Promise<unknown>) => Promise<void>;
const STATUS_LABELS = { TODO: '未开始', DOING: '进行中', DONE: '已完成' } as const;
const nowIn = (timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

/** 今天: the operations lead's home. Opening it lays out the day (POST /plan), then everything is read back. */
export function WorkbenchToday({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setData(await api<Data>('workbench')), []);
  useEffect(() => { api('workbench/plan', 'POST').then(load).catch((e: Error) => setError(e.message)); }, [load]);
  async function act(run: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await run(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const s = data.stats;
  const description = [dayTitle(data.today), s.yesterday ? `昨天完成 ${s.yesterday.done}/${s.yesterday.planned}` : s.restedYesterday ? '昨天休息' : '',
    `已连续复盘 ${s.streak} 天`, s.weekRate === null ? '' : `本周完成率 ${s.weekRate}%`].filter(Boolean).join(' · ');
  return <div className="bos-wb">
    <Header title="工作日历" description={description} actions={<WorkbenchNav current="today" />} />
    <DailySignCard />
    {error && <p className="bos-sales-error" role="alert">{error}</p>}
    <FocusCard focus={data.focus} month={data.month} week={data.week} busy={busy} act={act} />
    <div className="bos-wb-main">
      <Card className="bos-wb-today">
        <div className="bos-wb-section-head">
          <h2>今日三件事</h2>
          <small>{data.plannedAt ? `昨晚 ${timeIn(data.plannedAt, data.timezone)} 复盘时安排` : '开工时按紧急程度排好，可以调整'}</small>
          {data.events.map(e => <span key={e.id} className="bos-chat-tag is-green">{e.title}</span>)}
        </div>
        {data.urgent.map(u => <Link key={u.id} href={u.href ?? '/messages'} className="bos-wb-urgent">
          <AlertTriangle size={18} aria-hidden="true" />
          <span><strong>{u.title}</strong><small>{u.detail} · 系统自动置顶，处理完自动消失</small></span>
          <span className="bos-wb-urgent-go">去处理<ArrowUpRight size={14} aria-hidden="true" /></span>
        </Link>)}
        {data.three.length ? <ol className="bos-wb-list is-top">{data.three.map(item => <ItemRow key={item.id} item={item} big blocks={data.timeBlocks} timeZone={data.timezone} busy={busy} act={act} />)}</ol>
          : <EmptyState title="今天还没有三件事" description="添加一件，或从其他事项里挑；晚上复盘时可以直接排好明天的三件事。" />}
        <Others data={data} busy={busy} act={act} />
      </Card>
      <aside className="bos-wb-side">
        <ReviewCard data={data} />
        <TimeCard data={data} />
        <Signals signals={data.signals} />
      </aside>
    </div>
  </div>;
}

function FocusCard({ focus, month, week, busy, act }: { focus: Focus; month: string; week: string; busy: boolean; act: Act }) {
  const [editing, setEditing] = useState<string | null>(null);
  const empty = { title: '', target: '', progress: 0, targetValue: '', currentValue: 0, unit: '', parentId: '' };
  const [form, setForm] = useState(empty);
  const open = (id: string, values: Partial<typeof form>) => { setEditing(id); setForm({ ...empty, parentId: focus.months[0]?.id ?? '', ...values }); };
  const save = (level: 'MONTH' | 'WEEK') => act(async () => {
    const numbers = level === 'MONTH' ? { target: form.target, targetValue: form.targetValue ? Number(form.targetValue) : null, currentValue: form.currentValue, unit: form.unit, progress: form.progress } : {};
    if (editing?.startsWith('new')) await api('workbench/focus', 'POST', { level, periodKey: level === 'MONTH' ? month : week, title: form.title, ...numbers, ...(level === 'WEEK' ? { parentId: form.parentId } : {}) });
    else await api(`workbench/focus/${editing}`, 'PATCH', { title: form.title, ...numbers, ...(level === 'WEEK' && form.parentId ? { parentId: form.parentId } : {}) });
    setEditing(null);
  });
  const editor = (level: 'MONTH' | 'WEEK') => <form className="bos-wb-focus-form" onSubmit={e => { e.preventDefault(); void save(level); }}>
    <label><span>{level === 'MONTH' ? '月重心' : '周重心'}</span><input className="bos-input" value={form.title} required maxLength={200} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
    {level === 'MONTH' ? <>
      <div className="bos-wb-focus-numbers">
        <label><span>目标数</span><input className="bos-input" type="number" min={1} value={form.targetValue} placeholder="如 10" onChange={e => setForm({ ...form, targetValue: e.target.value })} /></label>
        <label><span>单位</span><input className="bos-input" value={form.unit} maxLength={8} placeholder="位 / 个 / 条" onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
        {form.targetValue ? <label><span>已完成</span><input className="bos-input" type="number" min={0} value={form.currentValue} onChange={e => setForm({ ...form, currentValue: Number(e.target.value) })} /></label>
          : <label><span>进度 %</span><input className="bos-input" type="number" min={0} max={100} value={form.progress} onChange={e => setForm({ ...form, progress: Number(e.target.value) })} /></label>}
      </div>
      <label><span>说明（可不填）</span><input className="bos-input" value={form.target} maxLength={200} placeholder="例如 10 位客户到厂参观" onChange={e => setForm({ ...form, target: e.target.value })} /></label>
    </> : <label><span>关联的月重心</span><select className="bos-input" value={form.parentId} required onChange={e => setForm({ ...form, parentId: e.target.value })}>
      {focus.months.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>}
    <div className="bos-wb-form-actions"><Button type="submit" variant="primary" disabled={busy}>保存</Button><Button onClick={() => setEditing(null)}>取消</Button></div>
  </form>;
  return <Card className="bos-wb-focus" id="focus" aria-label="本月和本周重心">
    <section>
      <div className="bos-wb-focus-head"><h2>本月重心</h2><small>{Number(month.slice(5))} 月</small></div>
      <ul className="bos-wb-focus-list">
        {focus.months.map(m => <li key={m.id}>{editing === m.id ? editor('MONTH') : <button type="button" className="bos-wb-focus-row" disabled={busy} aria-label={`编辑月重心 ${m.title}`}
          onClick={() => open(m.id, { title: m.title, target: m.target, progress: m.progress, targetValue: m.targetValue ? String(m.targetValue) : '', currentValue: m.currentValue, unit: m.unit })}>
          <span className="bos-wb-focus-line"><strong>{m.title}</strong><span>{m.targetValue ? `${m.currentValue} / ${m.targetValue} ${m.unit}` : m.target ? `${m.progress}% · ${m.target}` : `${m.progress}%`}</span></span>
          <span className="bos-wb-progress" role="progressbar" aria-label={`${m.title} 进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.progress}><i style={{ width: `${m.progress}%` }} /></span>
        </button>}</li>)}
      </ul>
      {focus.months.length < 3 && (editing === 'new-month' ? editor('MONTH') : <button type="button" className="bos-wb-focus-add" onClick={() => open('new-month', {})}><Plus size={14} />添加月重心</button>)}
    </section>
    <section>
      <div className="bos-wb-focus-head"><h2>本周重心</h2><small>{shortDay(week)} – {shortDay(addDays(week, 6))}</small></div>
      <ul className="bos-wb-week-chips">
        {focus.weeks.map(w => <li key={w.id} className={`is-${w.status.toLowerCase()}`}>{editing === w.id ? editor('WEEK') : <>
          {w.status === 'DONE' && <Check size={14} aria-hidden="true" />}
          <button type="button" className="bos-wb-link" onClick={() => open(w.id, { title: w.title, parentId: w.parentId ?? '' })} title={`服务于：${w.parentTitle || '未关联月重心'}`}>{w.title}</button>
          <label><span className="bos-sr-only">{w.title} 完成情况</span>
            <select value={w.status} disabled={busy} onChange={e => act(() => api(`workbench/focus/${w.id}`, 'PATCH', { status: e.target.value }))}>
              {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
        </>}</li>)}
      </ul>
      {focus.weeks.length < 3 && (editing === 'new-week' ? editor('WEEK')
        : <button type="button" className="bos-wb-focus-add" onClick={() => open('new-week', {})} disabled={!focus.months.length} title={focus.months.length ? '' : '先设定本月重心'}><Plus size={14} />添加周重心</button>)}
    </section>
  </Card>;
}

function timeChip(item: Item, blocks: Item[]) {
  if (!item.startTime) return '';
  const block = blocks.find(b => b.startTime === item.startTime);
  return block ? `${item.startTime} ${blockName(block.title)}` : `${item.startTime}–${item.endTime ?? ''}`;
}

function ItemRow({ item, big, blocks, timeZone, busy, act }: { item: Item; big?: boolean; blocks: Item[]; timeZone: string; busy: boolean; act: Act }) {
  const done = item.status === 'DONE';
  const when = timeChip(item, blocks);
  const body = <>
    <strong>{item.title}</strong>
    {item.detail && !big && <small>{item.detail}</small>}
    <span className="bos-wb-meta">
      <span className="bos-chat-tag">{categoryTag(item.category)}</span>
      {item.focusTitle && <span className="bos-chat-tag is-green">本周重心 · {item.focusTitle}</span>}
      {item.kind === 'FIXED' && <span className="bos-chat-tag is-muted">固定事项</span>}
      {item.carryCount > 0 && <span className="bos-chat-tag is-warning">顺延 {item.carryCount} 次</span>}
    </span>
  </>;
  return <li className={`bos-wb-item${big ? ' is-big' : ''}${done ? ' is-done' : ''}`}>
    <button type="button" className="bos-wb-check" aria-pressed={done} aria-label={done ? `把「${item.title}」标为未完成` : `完成「${item.title}」`} disabled={busy}
      onClick={() => act(() => api(`workbench/items/${item.id}`, 'PATCH', { status: done ? 'TODO' : 'DONE' }))}>{done && <Check size={14} />}</button>
    <div className="bos-wb-item-body">{item.href ? <Link href={item.href}>{body}</Link> : body}</div>
    <span className="bos-wb-when">{done && item.doneAt ? `${timeIn(item.doneAt, timeZone)} 完成` : when}</span>
    <div className="bos-wb-item-tools">
      <button type="button" className="bos-icon-button" disabled={busy} onClick={() => act(() => api(`workbench/items/${item.id}`, 'PATCH', { pin: big ? -1 : 1 }))}
        aria-label={big ? `把「${item.title}」移出三件事` : `把「${item.title}」放进三件事`} title={big ? '移出三件事' : '放进三件事'}>{big ? <PinOff size={15} /> : <Pin size={15} />}</button>
      <button type="button" className="bos-icon-button" disabled={busy} onClick={() => act(() => api(`workbench/items/${item.id}`, 'DELETE'))} aria-label={`删除「${item.title}」`} title="删除"><Trash2 size={15} /></button>
    </div>
  </li>;
}

function Others({ data, busy, act }: { data: Data; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'CONVERT', focusId: '' });
  const pin = data.three.length < 3;
  const teamDue = data.teamTasks.reduce((sum, t) => sum + t.due, 0);
  return <>
    <div className="bos-wb-folds">
      <button type="button" className="bos-wb-fold" aria-expanded={open} onClick={() => setOpen(v => !v)}><ChevronDown size={15} aria-hidden="true" />
        其他事项 {data.others.length}{teamDue ? <small> · 团队任务 {teamDue}</small> : null}</button>
      <button type="button" className="bos-wb-fold" aria-expanded={adding} onClick={() => setAdding(v => !v)}><Plus size={15} aria-hidden="true" />添加事项</button>
    </div>
    {adding && <form className="bos-wb-add" onSubmit={e => { e.preventDefault(); void act(async () => {
      await api('workbench/items', 'POST', { date: data.today, title: form.title, category: form.category, focusId: form.focusId || null, pin: pin ? 1 : 0 });
      setForm({ ...form, title: '' }); setAdding(false);
    }); }}>
      <label><span>事项</span><input className="bos-input" value={form.title} required maxLength={200} autoFocus onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label><span>类别</span><select className="bos-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><span>属于本周重心</span><select className="bos-input" value={form.focusId} onChange={e => setForm({ ...form, focusId: e.target.value })}><option value="">不关联</option>{data.focus.weeks.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
      <p className="bos-wb-muted">{pin ? '会放进今日三件事。' : '三件事已排满，会放进其他事项。'}</p>
      <div className="bos-wb-form-actions"><Button type="submit" variant="primary" disabled={busy}>添加</Button><Button onClick={() => setAdding(false)}>取消</Button></div>
    </form>}
    {open && <div className="bos-wb-others">
      {data.others.length ? <ul className="bos-wb-list">{data.others.map(item => <ItemRow key={item.id} item={item} blocks={data.timeBlocks} timeZone={data.timezone} busy={busy} act={act} />)}</ul>
        : <p className="bos-wb-muted">没有其他事项。</p>}
      {!!data.teamTasks.length && <><h3>业务员今天的跟进任务</h3><ul className="bos-wb-team">{data.teamTasks.map(t => <li key={t.name}><span>{t.name}</span><span>{t.due} 项{t.overdue ? <b> · 逾期 {t.overdue}</b> : ''}</span></li>)}</ul>
        <Link className="bos-text-link" href="/tasks">打开团队任务<ArrowUpRight size={13} /></Link></>}
    </div>}
  </>;
}

function ReviewCard({ data }: { data: Data }) {
  const { status } = data.review;
  if (status === 'SUBMITTED') return <Card className="bos-wb-review-card is-done" aria-label="今晚复盘">
    <span className="bos-wb-review-state"><Check size={16} aria-hidden="true" />今天已复盘 · {timeIn(data.review.submittedAt, data.timezone)}</span>
    {data.tomorrowPlan.length ? <><p>明天的三件事已排好：</p><ol>{data.tomorrowPlan.slice(0, 3).map(i => <li key={i.id}>{i.title}</li>)}</ol></> : <p>明天还没有排事项。</p>}
    <Link className="bos-text-link" href="/workbench/review">查看或修改<ArrowUpRight size={13} /></Link>
  </Card>;
  if (status === 'REST') return <Card className="bos-wb-review-card" aria-label="今晚复盘">
    <span className="bos-wb-review-state">今天休息</span>
    <p>不计入完成率，连续复盘不中断。</p>
    <Link className="bos-text-link" href="/workbench/review">改为复盘<ArrowUpRight size={13} /></Link>
  </Card>;
  const last = data.lastImprovement;
  return <Card className="bos-wb-review-card is-todo" aria-label="今晚复盘">
    <span className="bos-wb-review-state"><Clock size={16} aria-hidden="true" />今晚复盘 · {status === 'DRAFT' ? '草稿已保存' : '还没开始'}</span>
    <p>花 3 分钟回顾今天，安排好明天的三件事。每晚 21:30 提醒。</p>
    <Link className="bos-button bos-button-primary" href="/workbench/review">{status === 'DRAFT' ? '继续复盘' : '开始复盘'}</Link>
    {last && <div className="bos-wb-review-last"><span>{last.date === addDays(data.today, -1) ? '昨天' : shortDay(last.date)}写下的改进：</span><strong>{last.text}</strong></div>}
  </Card>;
}

function TimeCard({ data }: { data: Data }) {
  const [clock, setClock] = useState(data.clock);
  useEffect(() => { const tick = () => setClock(nowIn(data.timezone)); tick(); const timer = setInterval(tick, 60_000); return () => clearInterval(timer); }, [data.timezone]);
  if (!data.timeBlocks.length) return null;
  return <Card className="bos-wb-time" aria-label="今天的时间">
    <div className="bos-wb-section-head"><h2>今天的时间</h2><small>{zoneLabel(data.timezone)}</small></div>
    <ul>{data.timeBlocks.map(b => {
      const now = !!b.startTime && !!b.endTime && clock >= b.startTime && clock < b.endTime;
      const placed = data.three.filter(i => i.startTime === b.startTime);
      return <li key={b.id} className={now ? 'is-now' : ''} aria-current={now ? 'time' : undefined}>
        <span className="bos-wb-time-at">{b.startTime}</span>
        <span className="bos-wb-time-what"><span>{blockName(b.title)}{now && <b>现在</b>}</span>{placed.map(i => <small key={i.id}>{i.status === 'DONE' ? '✓ ' : ''}{i.title}</small>)}</span>
      </li>;
    })}</ul>
  </Card>;
}

function Signals({ signals }: { signals: Data['signals'] }) {
  // The energy split is one reminder, however many categories are off.
  const energy = signals.filter(s => s.key.startsWith('energy:'));
  const list = [...signals.filter(s => !s.key.startsWith('energy:')), ...energy.slice(0, 1).map(s => ({ ...s, key: 'energy',
    detail: `精力分配偏离：${energy.map(e => e.focus.replace(/^精力：/, '').split('，')[0]).join('、')}`, focus: energy.map(e => e.detail).join('；') }))];
  return <Card className="bos-wb-signals" aria-label="数据提醒"><h2>数据提醒</h2>
    {list.length ? <ul>{list.map(s => <li key={s.key}><Link href={s.href}><strong>{s.detail}</strong><span>{s.focus}</span><small>{s.title} · 条件解除后自动消失</small></Link></li>)}</ul>
      : <p className="bos-wb-muted">数据正常：按 BOS 数据和前 4 周比较，没有需要调整重心的地方。</p>}
  </Card>;
}
