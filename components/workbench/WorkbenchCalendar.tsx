'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, Header } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { CATEGORIES, type Category } from '@/lib/outreach';
import { addDays } from '@/lib/workbench';
import type { WorkbenchData } from '@/services/workbench-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Data = Jsonify<WorkbenchData>;
type DayData = Extract<Data, { top: unknown }>;
type WeekData = Exclude<Extract<Data, { days: unknown; signals: unknown }>, DayData>;
type MonthData = Exclude<Extract<Data, { days: unknown }>, WeekData>;
type Item = DayData['top'][number];
type Focus = Data['focus'];
type View = 'day' | 'week' | 'month';

const VIEWS: { key: View; label: string }[] = [{ key: 'day', label: '日' }, { key: 'week', label: '周' }, { key: 'month', label: '月' }];
const STATUS_LABELS = { TODO: '未开始', DOING: '进行中', DONE: '已完成' } as const;
const dayTitle = (key: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${key}T00:00:00Z`));
const shortDay = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const categoryTag = (category: string) => CATEGORIES[category as Category] ?? category;

/** 工作日历: the operations lead's home. Opening it lays out today (POST /plan), then everything is read back. */
export function WorkbenchCalendar({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (view: View, date: string) => {
    const next = await api<Data>(`workbench?view=${view}&date=${date}`);
    setData(next);
    window.history.replaceState(null, '', `/workbench?view=${view}&date=${date}`);
  }, []);
  useEffect(() => {
    if (initial.day !== initial.today) return;
    api('workbench/plan', 'POST').then(() => load(initial.view, initial.day)).catch((e: Error) => setError(e.message));
  }, [initial.day, initial.today, initial.view, load]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await run(); await load(data.view, data.day); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const go = (view: View, date: string) => load(view, date).catch((e: Error) => setError(e.message));
  const step = data.view === 'day' ? 1 : data.view === 'week' ? 7 : 0;
  const shift = (direction: number) => {
    if (step) return go(data.view, addDays(data.day, direction * step));
    const [y, m] = data.month.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + direction, 1)).toISOString().slice(0, 10);
    return go('month', target);
  };
  const period = data.view === 'day' ? dayTitle(data.day) : data.view === 'week' ? `${shortDay(data.week)} – ${shortDay(addDays(data.week, 6))} 这一周` : `${Number(data.month.slice(5))} 月`;

  return <div className="bos-wb">
    <Header title="工作日历" description={`${period} · 本月重心、本周重心和今天最该做的三件事`} actions={<>
      <div className="bos-wb-segment" role="group" aria-label="切换日历视图">
        {VIEWS.map(v => <button key={v.key} type="button" aria-pressed={data.view === v.key} onClick={() => go(v.key, data.day)}>{v.label}</button>)}
      </div>
      <Button variant="ghost" aria-label="上一段" onClick={() => shift(-1)}><ChevronLeft size={16} /></Button>
      <Button onClick={() => go(data.view, data.today)} disabled={data.day === data.today}>今天</Button>
      <Button variant="ghost" aria-label="下一段" onClick={() => shift(1)}><ChevronRight size={16} /></Button>
    </>} />
    {error && <p className="bos-sales-error" role="alert">{error}</p>}
    <FocusStrip focus={data.focus} month={data.month} week={data.week} busy={busy} act={act} />
    {'top' in data ? <DayView data={data} busy={busy} act={act} />
      : 'signals' in data ? <WeekView data={data as WeekData} />
      : <MonthView data={data as MonthData} onOpen={key => go('day', key)} />}
  </div>;
}

type Act = (run: () => Promise<unknown>) => Promise<void>;

function FocusStrip({ focus, month, week, busy, act }: { focus: Focus; month: string; week: string; busy: boolean; act: Act }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', target: '', progress: 0, parentId: '' });
  const open = (id: string, values: Partial<typeof form>) => { setEditing(id); setForm({ title: '', target: '', progress: 0, parentId: focus.months[0]?.id ?? '', ...values }); };
  const save = (level: 'MONTH' | 'WEEK') => act(async () => {
    if (editing?.startsWith('new')) await api('workbench/focus', 'POST', { level, periodKey: level === 'MONTH' ? month : week, title: form.title, target: form.target, progress: form.progress, ...(level === 'WEEK' ? { parentId: form.parentId } : {}) });
    else await api(`workbench/focus/${editing}`, 'PATCH', { title: form.title, target: form.target, progress: form.progress, ...(level === 'WEEK' && form.parentId ? { parentId: form.parentId } : {}) });
    setEditing(null);
  });
  const editor = (level: 'MONTH' | 'WEEK') => <form className="bos-wb-focus-form" onSubmit={e => { e.preventDefault(); void save(level); }}>
    <label><span>{level === 'MONTH' ? '月重心' : '周重心'}</span><input className="bos-input" value={form.title} required maxLength={200} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
    {level === 'MONTH' ? <>
      <label><span>目标值</span><input className="bos-input" value={form.target} maxLength={200} placeholder="例如 3 个批发客户首单" onChange={e => setForm({ ...form, target: e.target.value })} /></label>
      <label><span>进度 %</span><input className="bos-input" type="number" min={0} max={100} value={form.progress} onChange={e => setForm({ ...form, progress: Number(e.target.value) })} /></label>
    </> : <label><span>关联的月重心</span><select className="bos-input" value={form.parentId} required onChange={e => setForm({ ...form, parentId: e.target.value })}>
      {focus.months.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>}
    <div className="bos-wb-form-actions"><Button type="submit" variant="primary" disabled={busy}>保存</Button><Button onClick={() => setEditing(null)}>取消</Button></div>
  </form>;
  return <>
    <section className="bos-wb-focus" aria-label="本月重心">
      <h2>本月重心</h2>
      <div className="bos-wb-focus-row">
        {focus.months.map((m, i) => editing === m.id ? <Card key={m.id} className="bos-wb-focus-card">{editor('MONTH')}</Card>
          : <Card key={m.id} className="bos-wb-focus-card">
            <button type="button" className="bos-wb-focus-edit" onClick={() => open(m.id, { title: m.title, target: m.target, progress: m.progress })} aria-label={`编辑月重心 ${m.title}`}>
              <span className="bos-wb-index">{i + 1}</span><strong>{m.title}</strong>
              <small>{m.target ? `目标 ${m.target}` : '目标值待填'}</small>
              <span className="bos-wb-progress" role="progressbar" aria-label={`${m.title} 进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.progress}><i style={{ width: `${m.progress}%` }} /></span>
              <small>进度 {m.progress}%</small>
            </button>
          </Card>)}
        {focus.months.length < 3 && (editing === 'new-month' ? <Card className="bos-wb-focus-card">{editor('MONTH')}</Card>
          : <button type="button" className="bos-wb-focus-add" onClick={() => open('new-month', {})}><Plus size={15} />添加月重心</button>)}
      </div>
    </section>
    <section className="bos-wb-focus" aria-label="本周重心">
      <h2>本周重心</h2>
      <div className="bos-wb-focus-row">
        {focus.weeks.map((w, i) => editing === w.id ? <Card key={w.id} className="bos-wb-focus-card">{editor('WEEK')}</Card>
          : <Card key={w.id} className="bos-wb-focus-card is-week">
            <div className="bos-wb-week-head"><span className="bos-wb-index">{i + 1}</span>
              <button type="button" className="bos-wb-link" onClick={() => open(w.id, { title: w.title, parentId: w.parentId ?? '' })}><strong>{w.title}</strong></button></div>
            <small>服务于：{w.parentTitle || '未关联月重心'}</small>
            <label className="bos-wb-status"><span className="bos-sr-only">{w.title} 完成情况</span>
              <select value={w.status} disabled={busy} onChange={e => act(() => api(`workbench/focus/${w.id}`, 'PATCH', { status: e.target.value }))} className={`is-${w.status.toLowerCase()}`}>
                {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select></label>
          </Card>)}
        {focus.weeks.length < 3 && (editing === 'new-week' ? <Card className="bos-wb-focus-card">{editor('WEEK')}</Card>
          : <button type="button" className="bos-wb-focus-add" onClick={() => open('new-week', {})} disabled={!focus.months.length} title={focus.months.length ? '' : '先设定本月重心'}><Plus size={15} />添加周重心</button>)}
      </div>
    </section>
  </>;
}

function ItemRow({ item, big, busy, act, index }: { item: Item; big?: boolean; busy: boolean; act: Act; index?: number }) {
  const done = item.status === 'DONE';
  const body = <>
    <strong>{item.title}</strong>
    {item.detail && <small>{item.detail}</small>}
    <span className="bos-wb-meta">
      <span className="bos-chat-tag">{categoryTag(item.category)}</span>
      {item.focusTitle && <span className="bos-chat-tag is-green">本周重心 · {item.focusTitle}</span>}
      {item.kind === 'FIXED' && <span className="bos-chat-tag is-muted">固定事项</span>}
      {item.kind === 'SIGNAL' && <span className="bos-chat-tag is-warning">重心信号</span>}
      {item.carryCount > 0 && <span className="bos-chat-tag is-warning">顺延 {item.carryCount} 次</span>}
      {item.startTime && <span className="bos-chat-tag is-muted">{item.startTime}–{item.endTime}</span>}
    </span>
  </>;
  return <li className={`bos-wb-item${big ? ' is-big' : ''}${item.tone === 'danger' ? ' is-danger' : ''}${done ? ' is-done' : ''}`}>
    {index !== undefined && <span className="bos-wb-rank" aria-hidden="true">{index + 1}</span>}
    {item.live ? <span className="bos-wb-live-mark" aria-hidden="true">{item.tone === 'danger' ? <AlertTriangle size={16} /> : <ArrowUpRight size={16} />}</span>
      : <button type="button" className="bos-wb-check" aria-pressed={done} aria-label={done ? `把「${item.title}」标为未完成` : `完成「${item.title}」`} disabled={busy}
        onClick={() => act(() => api(`workbench/items/${item.id}`, 'PATCH', { status: done ? 'TODO' : 'DONE' }))}>{done && <Check size={14} />}</button>}
    <div className="bos-wb-item-body">{item.href ? <Link href={item.href}>{body}</Link> : body}</div>
    {!item.live && <div className="bos-wb-item-tools">
      {item.kind !== 'TIMEBLOCK' && <button type="button" className="bos-icon-button" disabled={busy} onClick={() => act(() => api(`workbench/items/${item.id}`, 'PATCH', { pin: big ? -1 : 1 }))}
        aria-label={big ? '移出三件事' : '放进三件事'} title={big ? '移出三件事' : '放进三件事'}>{big ? <PinOff size={15} /> : <Pin size={15} />}</button>}
      <button type="button" className="bos-icon-button" disabled={busy} onClick={() => act(() => api(`workbench/items/${item.id}`, 'DELETE'))} aria-label={`删除「${item.title}」`} title="删除"><Trash2 size={15} /></button>
    </div>}
  </li>;
}

function AddItem({ day, weeks, busy, act }: { day: string; weeks: Focus['weeks']; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'CONVERT', focusId: '', pin: false });
  if (!open) return <Button variant="ghost" onClick={() => setOpen(true)}><Plus size={15} />添加事项</Button>;
  return <form className="bos-wb-add" onSubmit={e => { e.preventDefault(); void act(async () => { await api('workbench/items', 'POST', { date: day, title: form.title, category: form.category, focusId: form.focusId || null, pin: form.pin ? 1 : 0 }); setForm({ ...form, title: '' }); setOpen(false); }); }}>
    <label><span>事项</span><input className="bos-input" value={form.title} required maxLength={200} autoFocus onChange={e => setForm({ ...form, title: e.target.value })} /></label>
    <label><span>类别</span><select className="bos-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label><span>属于本周重心</span><select className="bos-input" value={form.focusId} onChange={e => setForm({ ...form, focusId: e.target.value })}><option value="">不关联</option>{weeks.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
    <label className="bos-wb-inline"><input type="checkbox" checked={form.pin} onChange={e => setForm({ ...form, pin: e.target.checked })} />放进今日三件事</label>
    <div className="bos-wb-form-actions"><Button type="submit" variant="primary" disabled={busy}>添加</Button><Button onClick={() => setOpen(false)}>取消</Button></div>
  </form>;
}

function DayView({ data, busy, act }: { data: DayData; busy: boolean; act: Act }) {
  const [othersOpen, setOthersOpen] = useState(false);
  const others = data.others.length + data.timeBlocks.length + (data.teamTasks.length ? 1 : 0);
  return <div className="bos-wb-main">
    <Card className="bos-wb-today">
      <div className="bos-wb-section-head"><h2>{data.day === data.today ? '今日三件事' : `${dayTitle(data.day)} 的三件事`}</h2>
        {data.events.map(e => <span key={e.id} className="bos-chat-tag is-green">{e.title}</span>)}</div>
      {data.top.length ? <ol className="bos-wb-list is-top">{data.top.map((item, i) => <ItemRow key={item.id} item={item} big index={i} busy={busy} act={act} />)}</ol>
        : <EmptyState title="今天没有待办的重点" description="新线索、客户回复和重心信号会自动出现在这里；也可以手动添加事项。" />}
      <AddItem day={data.day} weeks={data.focus.weeks} busy={busy} act={act} />
      <button type="button" className="bos-wb-fold" aria-expanded={othersOpen} onClick={() => setOthersOpen(v => !v)}><ChevronDown size={15} aria-hidden="true" />其他事项（{others}）</button>
      {othersOpen && <div className="bos-wb-others">
        {!!data.others.length && <ul className="bos-wb-list">{data.others.map(item => <ItemRow key={item.id} item={item} busy={busy} act={act} />)}</ul>}
        {!!data.timeBlocks.length && <><h3>每日时间块（北京时间）</h3><ul className="bos-wb-list is-blocks">{data.timeBlocks.map(item => <ItemRow key={item.id} item={item} busy={busy} act={act} />)}</ul></>}
        {!!data.teamTasks.length && <><h3>业务员今天的跟进任务</h3><ul className="bos-wb-team">{data.teamTasks.map(t => <li key={t.name}><span>{t.name}</span><span>{t.due} 项{t.overdue ? <b> · 逾期 {t.overdue}</b> : ''}</span></li>)}</ul>
          <Link className="bos-text-link" href="/tasks">打开团队任务<ArrowUpRight size={13} /></Link></>}
        {!others && <p className="bos-wb-muted">没有其他事项。</p>}
      </div>}
    </Card>
    <aside className="bos-wb-side">
      {!!data.signals.length && <Signals signals={data.signals} />}
      <Energy energy={data.energy} />
    </aside>
  </div>;
}

function Signals({ signals }: { signals: DayData['signals'] }) {
  return <Card className="bos-wb-signals"><h2>重心信号</h2><p className="bos-wb-muted">按 BOS 数据和自己前 4 周比较，条件解除后自动消失。</p>
    <ul>{signals.map(s => <li key={s.key}><Link href={s.href}><strong>{s.title}</strong><span>{s.focus}</span><small>{s.detail}</small></Link></li>)}</ul></Card>;
}

function Energy({ energy }: { energy: DayData['energy'] }) {
  return <Card className="bos-wb-energy"><h2>本周精力分配</h2>
    <p className="bos-wb-muted">{energy.total ? `本周已完成 ${energy.total} 项，按类别统计` : '本周还没有完成的事项'}；对照 {energy.rows.map(r => `${r.target}%`).join(' / ')}。</p>
    <ul>{energy.rows.map(r => {
      const off = r.share !== null && energy.total >= energy.minItems && Math.abs(r.share - r.target) > energy.deviation;
      return <li key={r.key}><span>{r.label}</span>
        <span className="bos-wb-bar" role="img" aria-label={`${r.label} ${r.share ?? 0}%，目标 ${r.target}%`}><i style={{ width: `${r.share ?? 0}%` }} className={off ? 'is-off' : ''} /><b style={{ left: `${r.target}%` }} /></span>
        <span className={off ? 'bos-danger-text' : ''}>{r.share === null ? '—' : `${r.share}%`}<small> / {r.target}%</small></span></li>;
    })}</ul></Card>;
}

function WeekView({ data }: { data: WeekData }) {
  return <div className="bos-wb-main">
    <div className="bos-wb-week">
      {data.days.map(d => <Card key={d.key} className={`bos-wb-day${d.today ? ' is-today' : ''}`}>
        <h3><Link href={`/workbench?view=day&date=${d.key}`}>{d.label} <small>{shortDay(d.key)}</small></Link></h3>
        {d.events.map(e => <span key={e.id} className="bos-chat-tag is-green">{e.title}</span>)}
        {d.items.length ? <ul>{d.items.map(i => <li key={i.id} className={i.status === 'DONE' ? 'is-done' : ''}>{i.status === 'DONE' && <Check size={12} aria-label="已完成" />}{i.title}{i.carryCount > 0 && <small> 顺延 {i.carryCount}</small>}</li>)}</ul>
          : <p className="bos-wb-muted">—</p>}
      </Card>)}
    </div>
    <aside className="bos-wb-side">
      {!!data.signals.length && <Signals signals={data.signals} />}
      <Energy energy={data.energy} />
    </aside>
  </div>;
}

function MonthView({ data, onOpen }: { data: MonthData; onOpen: (key: string) => void }) {
  return <Card className="bos-wb-month">
    <div className="bos-wb-month-grid" aria-label={`${data.month} 月历`}>
      {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(d => <div key={d} className="bos-wb-month-head" aria-hidden="true">{d}</div>)}
      {data.days.map(d => <button key={d.key} type="button" className={`bos-wb-month-cell${d.inMonth ? '' : ' is-out'}${d.today ? ' is-today' : ''}`} onClick={() => onOpen(d.key)} aria-label={`${d.key}，${d.events.map(e => e.title).join('、') || '无重点事件'}`}>
        <span className="bos-wb-month-date">{Number(d.key.slice(8))}</span>
        {d.events.map(e => <span key={e.id} className="bos-wb-event">{e.title}</span>)}
        {d.highlights.map(h => <span key={h.id} className={`bos-wb-month-item${h.status === 'DONE' ? ' is-done' : ''}`}>{h.title}</span>)}
        {d.total > d.highlights.length && <small>另有 {d.total - d.highlights.length} 项</small>}
      </button>)}
    </div>
  </Card>;
}

