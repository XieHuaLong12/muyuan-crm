import type { Category } from './outreach';

/**
 * Work calendar rules that need no database (docs/OUTREACH_AND_WORKBENCH.md): local-day arithmetic on yyyy-MM-dd keys,
 * the fixed items of each weekday, the order of today's three things, and the Q4 2026 presets taken from
 * 《绿安居 10–12月运营与转化规划》.
 */

const parse = (key: string) => new Date(`${key}T00:00:00Z`);
export const addDays = (key: string, days: number) => { const d = parse(key); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
/** 1 = Monday … 7 = Sunday. */
export const weekday = (key: string) => ((parse(key).getUTCDay() + 6) % 7) + 1;
export const mondayOf = (key: string) => addDays(key, 1 - weekday(key));
export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
export const monthOf = (key: string) => key.slice(0, 7);
/** The last Friday of the month a day belongs to: when next month's focus is set. */
export function lastFridayOf(month: string) {
  const [year, m] = month.split('-').map(Number);
  let key = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
  while (weekday(key) !== 5) key = addDays(key, -1);
  return key;
}
/** Days shown in a month view: whole weeks, Monday first. */
export function monthGrid(month: string) {
  const first = `${month}-01`;
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let day = mondayOf(first); day <= addDays(mondayOf(last), 6); day = addDays(day, 1)) days.push(day);
  return days;
}
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export type FixedItem = { sourceKey: string; title: string; detail: string; category: Category; href: string };
/**
 * The fixed rhythm: Monday the ad check, Wednesday a look at the script test (look only), Friday the funnel review and
 * next week's focus, and on the last Friday of the month next month's focus. Keys carry the week, so an item carried
 * to another day never collides with that day's own.
 */
export function fixedItemsFor(day: string): FixedItem[] {
  const week = mondayOf(day), items: FixedItem[] = [];
  if (weekday(day) === 1) items.push({ sourceKey: `fixed:ads:${week}`, title: '广告周检 + 一周内容批量拍摄剪辑', category: 'FRONTEND', href: '/analytics/ads',
    detail: '看企业线索占比、单条线索成本、各国家线索量；其余时间只看异常，不动广告。' });
  if (weekday(day) === 3) items.push({ sourceKey: `fixed:script-test:${week}`, title: '查看话术测试进度（只看不改）', category: 'DATA', href: '/outreach',
    detail: '看各条话术的发送数和 24 小时回复率，不足 30 条不下结论。' });
  if (weekday(day) === 5) {
    items.push({ sourceKey: `fixed:funnel:${week}`, title: '周漏斗复盘，定下周重心', category: 'DATA', href: '/workbench/history',
      detail: '填周漏斗，找出掉得最多的一步，下周只改一件事（一句话术、一个素材或一个政策）。' });
    if (day === lastFridayOf(monthOf(day))) items.push({ sourceKey: `fixed:month:${monthOf(day)}`, title: '定下月重心（3 条）', category: 'DATA', href: '/workbench#focus',
      detail: '对照本月重心的进度，定下个月最多 3 条重心和目标值。' });
  }
  return items;
}

/**
 * Today's three things, in order: urgent (a new lead not answered within 5 minutes, an A or high-intent reply
 * waiting over 2 hours), what a focus signal asks for, the week focus tasks for today, the fixed items, then
 * the rest. A person can put an item into the three (pin 1) or take it out (pin -1).
 */
export const KIND_RANK: Record<string, number> = { URGENT: 0, SIGNAL: 1, FOCUS: 2, FIXED: 3, MANUAL: 4, EVENT: 5, TIMEBLOCK: 9 };
export type Rankable = { id: string; kind: string; pin: number; status: string; carryCount: number; startTime?: string | null; createdAt?: Date | string };
export function rankToday<T extends Rankable>(items: T[]): { top: T[]; others: T[] } {
  const order = (a: T, b: T) => (KIND_RANK[a.kind] ?? 8) - (KIND_RANK[b.kind] ?? 8) || b.carryCount - a.carryCount
    || String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id);
  const open = items.filter(i => i.status !== 'DONE' && i.kind !== 'TIMEBLOCK' && i.kind !== 'EVENT');
  // Urgent items are always on top; a person's pin comes next; what is left fills the three in order.
  const urgent = open.filter(i => i.kind === 'URGENT').sort(order);
  const pinned = open.filter(i => i.kind !== 'URGENT' && i.pin > 0).sort(order);
  const rest = open.filter(i => i.kind !== 'URGENT' && i.pin === 0).sort(order);
  const top = [...urgent, ...pinned, ...rest].slice(0, 3);
  const chosen = new Set(top.map(i => i.id));
  return { top, others: items.filter(i => !chosen.has(i.id)).sort((a, b) => Number(a.status === 'DONE') - Number(b.status === 'DONE') || order(a, b)) };
}

// ───────────────────────── Daily review ─────────────────────────

/** The nightly reminder to review the day, company time: 21:30 every day, weekends included. */
export const REVIEW_REMINDER = { hour: 21, minute: 30 };
export const OUTCOMES = { DONE: '完成', CARRIED: '顺延到明天', DROPPED: '不做了' } as const;
export type Outcome = keyof typeof OUTCOMES;
/** Why something was not done, with what to try next time (shown on the record page for the most frequent one). */
export const REASONS = {
  TIME: { label: '时间不够', advice: '三件事里留一件小事，大事拆成今天能做完的一步。' },
  INTERRUPTED: { label: '被打断', advice: '需要专注的事放上午，或给它留一个时间块。' },
  PRIORITY: { label: '优先级变了', advice: '排明天时先对照本周重心，不是重心的放进其他事项。' },
  STUCK: { label: '卡住了', advice: '卡住超过一天，就找人帮忙或换个做法。' },
  OTHER: { label: '其他', advice: '' },
} as const;
export type Reason = keyof typeof REASONS;
export const IMPROVEMENT_RESULTS = { YES: '做到了', PARTLY: '部分', NO: '没做到' } as const;
export type ImprovementResult = keyof typeof IMPROVEMENT_RESULTS;

/** One of the day's three things as kept in the review: its state that day, not wherever it moved since. */
export type ReviewItem = { itemId: string; title: string; category: string; focusTitle: string; carryCount: number; outcome: Outcome; reason: Reason | null; note: string };
/**
 * One of tomorrow's things as planned in the review: an existing item, tomorrow's fixed item, or a new one (a draft
 * keeps it without an id until the review is submitted; `created` marks the items the review made).
 */
export type PlanItem = {
  itemId: string; fixedKey: string | null; focusId: string | null; href: string | null; title: string; category: string; focusTitle: string;
  startTime: string | null; endTime: string | null; created: boolean;
};

export function countOutcomes(items: Pick<ReviewItem, 'outcome'>[]) {
  return { planned: items.length, done: items.filter(i => i.outcome === 'DONE').length, carried: items.filter(i => i.outcome === 'CARRIED').length,
    dropped: items.filter(i => i.outcome === 'DROPPED').length };
}

/**
 * Days reviewed in a row, ending today. A submitted review counts; a day marked as rest keeps the run without adding
 * to it; a day not reviewed (its three things recorded by the system, or a draft never submitted) ends it. A day with
 * nothing at all is a day off nobody marked: one is let through (rest days are irregular), two in a row end the run.
 * Today is still open, so only a submitted review changes anything.
 */
export function reviewStreak(rows: { date: string; status: string }[], today: string) {
  const byDate = new Map(rows.map(r => [r.date, r.status]));
  const dates = rows.map(r => r.date).filter(d => d <= today).sort();
  let current = 0, longest = 0, gap = 0;
  if (!dates.length) return { current, longest };
  for (let day = dates[0]; day <= today; day = addDays(day, 1)) {
    const status = byDate.get(day);
    if (status === 'SUBMITTED') { current++; gap = 0; }
    else if (status === 'REST') gap = 0;
    else if (day === today) break;
    else if (status === 'MISSED' || status === 'DRAFT') { current = 0; gap = 0; }
    else if (++gap >= 2) current = 0;
    longest = Math.max(longest, current);
  }
  return { current, longest };
}

/** The three things done over days that count: reviewed or recorded by the system. Rest days and drafts do not. */
export function completion(rows: { status: string; done: number; planned: number }[]) {
  const counted = rows.filter(r => r.status === 'SUBMITTED' || r.status === 'MISSED');
  const done = counted.reduce((sum, r) => sum + r.done, 0), planned = counted.reduce((sum, r) => sum + r.planned, 0);
  return { days: counted.length, done, planned, rate: planned ? Math.round(done / planned * 100) : null };
}

export type ReviewFields = {
  items: ReviewItem[]; plan: PlanItem[]; wins: string; problems: string; improvement: string; lastImprovement: string | null; energy: number | null; focusLevel: number | null;
};
export type Change = { field: string; label: string; before: string; after: string };
const itemsText = (items: PlanItem[]) => items.map(i => i.title).join('、') || '—';
/** What an edit changed, in words, for the record of a submitted review. */
export function reviewChanges(before: ReviewFields, after: ReviewFields): Change[] {
  const changes: Change[] = [];
  const text = (field: keyof ReviewFields, label: string, show: (v: never) => string = v => String(v ?? '') || '—') => {
    const a = show(before[field] as never), b = show(after[field] as never);
    if (a !== b) changes.push({ field, label, before: a, after: b });
  };
  for (const item of after.items) {
    const old = before.items.find(i => i.itemId === item.itemId);
    if (!old) continue;
    const describe = (i: ReviewItem) => [OUTCOMES[i.outcome], i.reason ? REASONS[i.reason].label : '', i.note].filter(Boolean).join(' · ');
    if (describe(old) !== describe(item)) changes.push({ field: `item:${item.itemId}`, label: `「${item.title}」`, before: describe(old), after: describe(item) });
  }
  text('lastImprovement', '昨天的改进', v => IMPROVEMENT_RESULTS[v as ImprovementResult] ?? '—');
  text('wins', '做得好的');
  text('problems', '遇到的问题');
  text('improvement', '明天改进');
  text('energy', '精力', v => v ? `${v} 分` : '—');
  text('focusLevel', '专注', v => v ? `${v} 分` : '—');
  text('plan', '明天的安排', v => itemsText(v));
  return changes;
}

/** The short name of a time block: what comes before its first comma or bracket. */
export const blockName = (title: string) => title.split(/[：:，,；;（(]/)[0].trim() || title;

// ───────────────────────── Q4 2026 presets ─────────────────────────

export type PresetFocus = { key: string; title: string; target: string; category: Category };
export const PRESET_MONTHS: Record<string, PresetFocus[]> = {
  '2026-10': [
    { key: 'oct-fair', title: '广交会客户邀约到厂', target: '', category: 'CONVERT' },
    { key: 'oct-grading', title: '线索分级和跟进节奏执行', target: '', category: 'CONVERT' },
    { key: 'oct-bos', title: 'BOS新增字段上线', target: '', category: 'DATA' },
  ],
  '2026-11': [
    { key: 'nov-test', title: '话术测试第1–2轮', target: '2 轮出结论', category: 'DATA' },
    { key: 'nov-handover', title: '业务员入职完成4周交接', target: '4 周交接', category: 'CONVERT' },
    { key: 'nov-samples', title: '广交会客户推进到寄样', target: '', category: 'CONVERT' },
  ],
  '2026-12': [
    { key: 'dec-wholesale', title: '拿下首批3个批发客户', target: '3 个批发客户首单', category: 'CONVERT' },
    { key: 'dec-winner', title: '胜出话术固化进话术库', target: '', category: 'DATA' },
    { key: 'dec-review', title: '启动期复盘、定2027计划', target: '', category: 'DATA' },
  ],
};
/** Week focus by Monday, each tied to the month focus it serves (required). */
export const PRESET_WEEKS: Record<string, { title: string; parent: string; category: Category }[]> = {
  '2026-10-19': [{ title: '广交会邀约全部发出', parent: 'oct-fair', category: 'CONVERT' }, { title: '定好接送和到厂路线', parent: 'oct-fair', category: 'CONVERT' }],
  '2026-10-26': [{ title: '广交会和换展期客户到厂', parent: 'oct-fair', category: 'CONVERT' }, { title: '见面后48小时内跟进', parent: 'oct-fair', category: 'CONVERT' }],
  '2026-11-02': [{ title: '广交会客户第2次跟进', parent: 'nov-samples', category: 'CONVERT' }, { title: '话术测试第1轮开始（T0两版）', parent: 'nov-test', category: 'DATA' }],
  '2026-11-09': [{ title: '业务员到岗第1周（预计）', parent: 'nov-handover', category: 'CONVERT' }, { title: 'BOS日历和话术记录试运行', parent: 'nov-test', category: 'DATA' }],
  '2026-11-16': [{ title: '业务员接B类线索', parent: 'nov-handover', category: 'CONVERT' }, { title: '第1轮测试中期查看', parent: 'nov-test', category: 'DATA' }],
  '2026-11-23': [{ title: '第1轮出结论', parent: 'nov-test', category: 'DATA' }, { title: '第2轮开始', parent: 'nov-test', category: 'DATA' }],
  '2026-11-30': [{ title: '业务员旁听A类对话', parent: 'nov-handover', category: 'CONVERT' }, { title: '推进寄样客户', parent: 'nov-samples', category: 'CONVERT' }],
  '2026-12-07': [{ title: '业务员主跟A类', parent: 'dec-wholesale', category: 'CONVERT' }, { title: '首单报价', parent: 'dec-wholesale', category: 'CONVERT' }],
  '2026-12-14': [{ title: '第2轮出结论', parent: 'dec-winner', category: 'DATA' }, { title: '决定是否开第3轮', parent: 'dec-winner', category: 'DATA' }],
  '2026-12-21': [{ title: '启动期复盘', parent: 'dec-review', category: 'DATA' }],
  '2026-12-28': [{ title: '2027年计划定稿', parent: 'dec-review', category: 'DATA' }],
};
/** Daily time blocks, Beijing time, Monday to Friday; the customer's local time in brackets. */
export const PRESET_TIME_BLOCKS: { startTime: string; endTime: string; title: string; category: Category }[] = [
  { startTime: '09:00', endTime: '10:00', title: 'CRM整理：回复夜间消息、打标签；澳洲客户（悉尼中午）', category: 'CONVERT' },
  { startTime: '10:00', endTime: '11:00', title: '内容发布、回复评论', category: 'FRONTEND' },
  { startTime: '11:00', endTime: '11:30', title: '广告快速查看，只看异常', category: 'FRONTEND' },
  { startTime: '14:00', endTime: '16:30', title: '中东客户跟进，A类优先（迪拜 10:00–12:30）', category: 'CONVERT' },
  { startTime: '16:30', endTime: '18:30', title: '欧洲客户跟进（巴黎 9:30–11:30，10/25 起冬令时）', category: 'CONVERT' },
  { startTime: '20:00', endTime: '21:00', title: '晚间回复，处理当天新线索（巴黎 13:00–14:00）', category: 'CONVERT' },
];
/** Key events shown in the month view. Dates from 商务部：第140届广交会情况介绍 (cited in the plan). */
export const PRESET_EVENTS: { sourceKey: string; date: string; endDate: string; title: string; detail: string; category: Category }[] = [
  { sourceKey: 'preset:canton-2026-phase2', date: '2026-10-23', endDate: '2026-10-27', title: '广交会二期（家具展）', detail: '邀约视频持续投放；每晚确认次日到厂或见面的客户。', category: 'CONVERT' },
  { sourceKey: 'preset:canton-2026-changeover', date: '2026-10-28', endDate: '2026-10-30', title: '广交会换展期（展馆关闭）', detail: '重点邀约还留在广州的客户到厂，工厂距展馆约 30 公里。', category: 'CONVERT' },
];
