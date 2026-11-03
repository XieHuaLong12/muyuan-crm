import { clockIn, WEEKDAYS, type WorkHours } from './entry-time';

/**
 * 国家作战卡 (docs/METRICS.md §国家作战卡): the pure rules behind the page. The service loads one country's leads
 * and messages; what a heatmap cell, a follow-up touch, a read receipt or a finding is, is decided here.
 */

/** A cell with fewer people than this is not coloured: too few to read anything into. */
export const MIN_CELL = 3;
/** A finding (a pattern worth acting on) needs at least this many people in each group it compares. */
export const MIN_GROUP = 20;
/** A reply counts when it comes within this long after our message. */
export const REPLY_WINDOW_MS = 72 * 3_600_000;
/** Messages we send within this long of each other are one touch (a greeting and a catalogue are one try). */
export const TOUCH_GAP_MS = 3_600_000;

export const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 10 : null;

export type Cell = { n: number; hits: number };
export type Grid = Cell[][];
export const emptyGrid = (): Grid => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, hits: 0 })));

/** Counts each item into weekday × hour of its instant in a zone; `hit` is what the rate is about (A/B, replied). */
export function heat<T>(items: T[], at: (item: T) => Date, hit: (item: T) => boolean, zone: string) {
  const grid = emptyGrid();
  for (const item of items) {
    const { weekday, hour } = clockIn(at(item), zone);
    grid[weekday][hour].n++;
    if (hit(item)) grid[weekday][hour].hits++;
  }
  return grid;
}

/** The grid as the page draws it: each cell's rate when it has enough people, and whether it falls in working hours. */
export function gridView(grid: Grid, offHour: (weekday: number, hour: number) => boolean) {
  return grid.map((row, weekday) => ({
    day: WEEKDAYS[weekday],
    cells: row.map((c, hour) => ({ n: c.n, hits: c.hits, rate: c.n >= MIN_CELL ? pct(c.hits, c.n) : null, off: offHour(weekday, hour) })),
  }));
}

/** Rate per weekday (summing the hours) and per hour (summing the days). */
export function marginals(grid: Grid) {
  const days = grid.map(row => row.reduce((s, c) => ({ n: s.n + c.n, hits: s.hits + c.hits }), { n: 0, hits: 0 }));
  const hours = Array.from({ length: 24 }, (_, hour) => grid.reduce((s, row) => ({ n: s.n + row[hour].n, hits: s.hits + row[hour].hits }), { n: 0, hits: 0 }));
  return { days, hours };
}

/**
 * The best run of `width` consecutive hours (company time, inside working hours) to send in, by reply rate, when it
 * holds at least MIN_GROUP sends. Returns its start hour, rate and size; null when no window has enough sends.
 */
export function bestWindow(hours: Cell[], work: WorkHours, width = 3) {
  let best: { start: number; end: number; rate: number; n: number } | null = null;
  for (let start = work.start; start + width <= work.end; start++) {
    const slice = hours.slice(start, start + width);
    const n = slice.reduce((s, c) => s + c.n, 0), hits = slice.reduce((s, c) => s + c.hits, 0);
    const rate = pct(hits, n);
    if (n >= MIN_GROUP && rate !== null && (!best || rate > best.rate)) best = { start, end: start + width, rate, n };
  }
  return best;
}

export type Msg = { direction: string; sentAt: Date; readAt?: Date | null };
/**
 * Our tries to get an answer: outbound messages close together form one touch; the count starts again after the
 * customer writes. A touch is answered when the customer writes within REPLY_WINDOW_MS and before our next touch.
 * Touches whose window has not closed yet are left out (`now`), so recent sends do not look unanswered.
 */
export function touches(messages: Msg[], now: Date) {
  const sorted = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const out: { n: number; at: Date; replied: boolean }[] = [];
  let count = 0, last: Date | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.direction === 'INBOUND') { count = 0; last = null; continue; }
    if (last && m.sentAt.getTime() - last.getTime() < TOUCH_GAP_MS) { last = m.sentAt; continue; }
    count++; last = m.sentAt;
    if (now.getTime() - m.sentAt.getTime() < REPLY_WINDOW_MS) continue;
    let replied = false;
    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      if (next.sentAt.getTime() - m.sentAt.getTime() > REPLY_WINDOW_MS) break;
      if (next.direction === 'INBOUND') { replied = true; break; }
      // Another touch started before any reply: the reply (if any) belongs to that one.
      if (next.sentAt.getTime() - sorted[j - 1].sentAt.getTime() >= TOUCH_GAP_MS) break;
    }
    out.push({ n: count, at: m.sentAt, replied });
  }
  return out;
}

/** Reply rate by touch number 1–4 and 5+ (the last row holds every touch from the fifth on). */
export function touchRates(all: { n: number; replied: boolean }[]) {
  return [1, 2, 3, 4, 5].map(k => {
    const rows = all.filter(t => k === 5 ? t.n >= 5 : t.n === k);
    return { label: k === 5 ? '第 5 次以后' : `第 ${k} 次`, n: rows.length, replied: rows.filter(t => t.replied).length, rate: pct(rows.filter(t => t.replied).length, rows.length) };
  });
}

export type Finding = { tag: string; tone: 'entry' | 'send' | 'day' | 'follow' | 'speed'; title: string; body: string; action: string; basis: string; weight: number };

/**
 * The patterns worth acting on, strongest first, at most three. Each compares groups of at least MIN_GROUP people
 * and states its evidence; a gap too small to matter is left out. Correlation, not proof: the page says so.
 */
export function findings(input: {
  country: string; workText: string;
  entry: { offN: number; offEffective: number; inN: number; inEffective: number; offShare: number | null };
  send: { best: { start: number; end: number; rate: number; n: number; localStart: string; localEnd: string } | null; overall: number | null; total: number };
  days: { label: string; n: number; rate: number | null }[];
  follow: { label: string; n: number; rate: number | null }[];
  speed: { fastN: number; fastRate: number | null; slowN: number; slowRate: number | null };
}): Finding[] {
  const out: Finding[] = [];
  const { entry, send, days, follow, speed, country } = input;
  const offRate = pct(entry.offEffective, entry.offN), inRate = pct(entry.inEffective, entry.inN);
  if (entry.offN >= MIN_GROUP && entry.inN >= MIN_GROUP && offRate !== null && inRate !== null && inRate - offRate >= 8) {
    out.push({ tag: '进线时间', tone: 'entry', weight: inRate - offRate,
      title: `${entry.offShare ?? 0}% 的${country} A / B 线索在你下班后进来，这批有效率只有 ${offRate}%`,
      body: `工作时间（${input.workText}）外进线的 A / B 要等到你上班才联系；工作时间内进线的有效率是 ${inRate}%。`,
      action: '上班第一件事先处理夜里进线的 A / B；或者把这个国家的广告集中在你的工作时间投放。',
      basis: `依据：工作时间外 ${entry.offN} 位 vs 工作时间内 ${entry.inN} 位 A / B` });
  }
  if (send.best && send.overall !== null && send.best.rate - send.overall >= 6) {
    out.push({ tag: '发送时间', tone: 'send', weight: send.best.rate - send.overall,
      title: `北京 ${send.best.start}–${send.best.end} 点（${country} ${send.best.localStart}–${send.best.localEnd}）发首条，回复率 ${send.best.rate}%`,
      body: `同样的首条消息，平均回复率是 ${send.overall}%。`,
      action: `新线索的首条和报价跟进，尽量放在北京 ${send.best.start}:00–${send.best.end}:00 发。`,
      basis: `依据：这个时段 ${send.best.n} 次首条 · 共 ${send.total} 次` });
  }
  const solid = days.filter(d => d.n >= MIN_GROUP && d.rate !== null) as { label: string; n: number; rate: number }[];
  if (solid.length >= 2) {
    const top = solid.reduce((a, b) => b.rate > a.rate ? b : a), low = solid.reduce((a, b) => b.rate < a.rate ? b : a);
    if (top.rate - low.rate >= 12) out.push({ tag: '星期', tone: 'day', weight: top.rate - low.rate,
      title: `${top.label}进线的 A / B 占比 ${top.rate}%，${low.label}只有 ${low.rate}%`,
      body: `按${country}当地的星期算；同样的广告钱，${top.label}带来的优质线索更多。`,
      action: `考虑把${low.label}的一部分预算挪到${top.label}（在 Meta 后台改，7 天后看效果）。`,
      basis: `依据：${top.label} ${top.n} 位 · ${low.label} ${low.n} 位进线` });
  }
  const third = follow[2];
  if (third && third.n >= MIN_GROUP && third.rate !== null && third.rate < 10) {
    out.push({ tag: '跟进次数', tone: 'follow', weight: 10 - third.rate + 4,
      title: `第 3 次主动发消息后，只有 ${third.rate}% 的客户回复`,
      body: `第 1 次是 ${follow[0]?.rate ?? '—'}%，第 2 次 ${follow[1]?.rate ?? '—'}%。再往后发，回的人更少。`,
      action: '第 3 次换个说法（比如问交期或发一个新产品），之后停下来，过一段时间再联系。',
      basis: `依据：第 3 次共 ${third.n} 次` });
  }
  if (speed.fastN >= MIN_GROUP && speed.slowN >= MIN_GROUP && speed.fastRate !== null && speed.slowRate !== null && speed.fastRate - speed.slowRate >= 10) {
    out.push({ tag: '首联速度', tone: 'speed', weight: speed.fastRate - speed.slowRate,
      title: `30 分钟内首联的 A / B，有效率 ${speed.fastRate}%；2 小时以后才联系的只有 ${speed.slowRate}%`,
      body: '越早联系，客户越可能还在看手机、还没去问别家。',
      action: '新 A / B 线索进来就先发第一条，哪怕只是打个招呼、说稍后发目录。',
      basis: `依据：30 分钟内 ${speed.fastN} 位 · 2 小时以后 ${speed.slowN} 位` });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 3);
}
