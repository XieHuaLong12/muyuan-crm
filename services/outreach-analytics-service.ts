import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { dayKey, periodRange } from '@/lib/time';
import {
  COUNTED_MATCHES, DAY, GRADES, POSITION_LABELS, SCRIPT_STATUSES, SUGGESTIONS, isEffective, judgeArms, percent, positionEnum, readConfig,
  type ArmResult, type OutreachConfig, type Suggestion,
} from '@/lib/outreach';

/**
 * 话术效果看板. Scripts are compared only within one touch position (T0 with T0), by 24-hour reply rate, separately
 * per grade. A touch counts for its script when the script was identified and sent as written or lightly edited;
 * the denominator is touches that have had their 24 hours (or were answered), so a script sent this morning is not
 * pulled down. Late replies are counted on their own. Filters apply to the cards, the ranking and the grade matrix.
 */
export const dashboardQuery = z.object({
  position: positionEnum.default('T0'),
  grade: z.enum(['ALL', ...GRADES]).default('ALL'),
  language: z.enum(['ALL', 'en', 'fr', 'ar']).default('ALL'),
  range: z.enum(['30', '90', '180', 'all']).default('30'),
  channel: z.enum(['ALL', 'TEMPLATE', 'MANUAL']).default('ALL'),
});
export type DashboardQuery = z.infer<typeof dashboardQuery>;

const touchSelect = { id: true, scriptId: true, grade: true, language: true, channel: true, matchType: true, judgeStatus: true, replied24h: true, lateReply: true,
  replyQuality: true, senderId: true, sentAt: true, code: true } satisfies Prisma.OutreachTouchSelect;
type TouchRow = Prisma.OutreachTouchGetPayload<{ select: typeof touchSelect }>;

const counted = (t: TouchRow) => !!t.scriptId && (COUNTED_MATCHES as readonly string[]).includes(t.matchType) && t.judgeStatus === 'DONE';
const matured = (t: TouchRow) => t.replied24h !== null;
type Tally = { sent: number; matured: number; replied: number; effective: number; late: number };
function tally(rows: TouchRow[]): Tally {
  return rows.reduce((sum, t) => ({ sent: sum.sent + 1, matured: sum.matured + (matured(t) ? 1 : 0), replied: sum.replied + (t.replied24h ? 1 : 0),
    effective: sum.effective + (t.replied24h && isEffective(t.replyQuality) ? 1 : 0), late: sum.late + (t.lateReply ? 1 : 0) }), { sent: 0, matured: 0, replied: 0, effective: 0, late: 0 });
}
const arm = (t: Tally) => ({ replied: t.replied, sent: t.matured });

function touchWhere(query: DashboardQuery, since: Date | null, until?: Date): Prisma.OutreachTouchWhereInput {
  return { code: query.position, judgeStatus: { not: 'VOID' }, customer: { deletedAt: null },
    ...(since || until ? { sentAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}),
    ...(query.language !== 'ALL' ? { language: query.language } : {}),
    ...(query.channel === 'TEMPLATE' ? { channel: 'BOS_TEMPLATE' } : query.channel === 'MANUAL' ? { channel: { in: ['BOS_FREE', 'PHONE'] } } : {}) };
}

type Script = { id: string; code: string; status: string; content: string; versionNote: string; grades: string; language: string };

/**
 * Per grade, the script to use: the one most likely best among scripts past the sample threshold. A grade without
 * enough data borrows the A+B merged data, labelled as such.
 */
function recommend(scripts: Script[], rows: TouchRow[], config: OutreachConfig) {
  const countedRows = rows.filter(counted);
  const per = (grades: readonly string[]) => scripts.map(s => tally(countedRows.filter(t => t.scriptId === s.id && grades.includes(t.grade))));
  const pick = (tallies: Tally[]) => {
    const results = judgeArms(tallies.map(arm), config);
    let best = -1;
    results.forEach((r, i) => { if (r.probability !== null && (best < 0 || r.probability > results[best].probability!)) best = i; });
    return { results, best };
  };
  return GRADES.map(grade => {
    const tallies = per([grade]);
    const own = pick(tallies);
    const merged = own.best < 0 ? pick(per(['A', 'B'])) : null;
    const best = own.best >= 0 ? own.best : merged?.best ?? -1;
    return { grade, cells: scripts.map((s, i) => ({ scriptId: s.id, ...tallies[i], rate: percent(tallies[i].replied, tallies[i].matured),
      enough: tallies[i].matured >= config.minSample, probability: own.results[i].probability, suggestion: own.results[i].suggestion })),
      recommended: best >= 0 ? scripts[best].id : null, merged: own.best < 0 && best >= 0,
      mergedProbability: own.best < 0 && merged && best >= 0 ? merged.results[best].probability : null };
  });
}

async function setup() {
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachConfig: true, timezone: true, outreachStartedAt: true } });
  return { config: readConfig(setting.outreachConfig), timezone: setting.timezone, startedAt: setting.outreachStartedAt };
}

export async function outreachDashboard(user: Actor, input: unknown = {}, now = new Date()) {
  void user;
  const query = dashboardQuery.parse(input);
  const { config, timezone, startedAt } = await setup();
  const since = query.range === 'all' ? null : new Date(now.getTime() - Number(query.range) * DAY);
  const [rows, scripts, report] = await Promise.all([
    db.outreachTouch.findMany({ where: touchWhere(query, since), select: touchSelect }),
    db.outreachScript.findMany({ where: { position: query.position, ...(query.language !== 'ALL' ? { language: query.language } : {}) },
      select: { id: true, code: true, status: true, content: true, versionNote: true, grades: true, language: true }, orderBy: { code: 'asc' } }),
    db.outreachReport.findFirst({ orderBy: { weekStart: 'desc' } }),
  ]);
  const inGrade = (t: TouchRow) => query.grade === 'ALL' || t.grade === query.grade;
  const filtered = rows.filter(inGrade);
  const countedRows = filtered.filter(counted);
  // Scripts shown: those active, plus retired ones that still have touches in the period.
  const shown = scripts.filter(s => s.status !== 'RETIRED' || countedRows.some(t => t.scriptId === s.id));
  const tallies = shown.map(s => tally(countedRows.filter(t => t.scriptId === s.id)));
  const results: ArmResult[] = judgeArms(tallies.map(arm), config);
  const nonStandard = tally(filtered.filter(t => !counted(t) && t.judgeStatus === 'DONE'));
  const all = tally(filtered);
  const matrix = recommend(shown, rows, config).filter(g => query.grade === 'ALL' || g.grade === query.grade);
  return {
    query, generatedAt: now, timezone, startedAt, positionLabel: POSITION_LABELS[query.position], minSample: config.minSample,
    cards: { sent: all.sent, replyRate: percent(all.replied, all.matured), effectiveRate: percent(all.effective, all.matured), pending: all.sent - all.matured,
      late: all.late, testing: scripts.filter(s => s.status === 'TESTING').length, waiting: filtered.filter(t => t.judgeStatus !== 'DONE').length },
    ranking: shown.map((s, i) => ({ id: s.id, code: s.code, status: s.status, statusLabel: SCRIPT_STATUSES[s.status as keyof typeof SCRIPT_STATUSES] ?? s.status,
      content: s.content, versionNote: s.versionNote, language: s.language, ...tallies[i],
      replyRate: percent(tallies[i].replied, tallies[i].matured), effectiveRate: percent(tallies[i].effective, tallies[i].matured),
      probability: results[i].probability, suggestion: results[i].suggestion, suggestionLabel: SUGGESTIONS[results[i].suggestion] }))
      .sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1) || (b.replyRate ?? -1) - (a.replyRate ?? -1) || a.code.localeCompare(b.code)),
    nonStandard: { ...nonStandard, replyRate: percent(nonStandard.replied, nonStandard.matured) },
    matrix: matrix.map(g => ({ ...g, cells: g.cells.map(c => ({ ...c, code: shown.find(s => s.id === c.scriptId)!.code })) })),
    report: report ? { weekStart: report.weekStart, lines: report.lines as ReportLine[], generatedAt: report.generatedAt, live: false }
      : { weekStart: weekStartKey(now, timezone), lines: await conclusionLines(now, config), generatedAt: now, live: true },
    quality: await qualityChecks(user, now, config, timezone),
  };
}
export type OutreachDashboard = Awaited<ReturnType<typeof outreachDashboard>>;

/** Who sends their own words instead of the library, and how often a person had to correct DeepSeek this month. */
async function qualityChecks(user: Actor, now: Date, config: OutreachConfig, timezone: string) {
  const week = new Date(now.getTime() - 7 * DAY);
  const month = periodRange('MONTH', dayKey(now, timezone), timezone);
  const [judged, users, overrides, aiTouches, aiReplies] = await Promise.all([
    db.outreachTouch.findMany({ where: { sentAt: { gte: week }, judgeStatus: 'DONE', matchType: { not: '' }, customer: { deletedAt: null } }, select: { senderId: true, matchType: true, scriptId: true } }),
    db.user.findMany({ select: { id: true, name: true } }),
    db.outreachOverride.findMany({ where: { createdAt: { gte: month.start, lt: month.end }, aiOriginal: true, reason: { not: 'VOICE_IMAGE' } }, select: { touchId: true, replyId: true } }),
    db.outreachTouch.count({ where: { judgedAt: { gte: month.start, lt: month.end }, OR: [{ judgedBy: 'AI' }, { overrides: { some: { aiOriginal: true } } }] } }),
    db.outreachReply.count({ where: { judgedAt: { gte: month.start, lt: month.end }, OR: [{ judgedBy: 'AI' }, { overrides: { some: { aiOriginal: true } } }] } }),
  ]);
  const names = new Map(users.map(u => [u.id, u.name]));
  const bySender = new Map<string, { total: number; nonStandard: number }>();
  for (const t of judged) {
    const key = t.senderId ?? '';
    const entry = bySender.get(key) ?? { total: 0, nonStandard: 0 };
    entry.total++;
    if (!(COUNTED_MATCHES as readonly string[]).includes(t.matchType) || !t.scriptId) entry.nonStandard++;
    bySender.set(key, entry);
  }
  const people = [...bySender].map(([id, v]) => ({ id, name: names.get(id) ?? '未知业务员', total: v.total, share: v.total ? v.nonStandard / v.total : 0,
    alert: v.total > 0 && v.nonStandard / v.total > config.nonStandardShare }))
    .filter(p => user.role === 'ADMIN' || p.id === user.id).sort((a, b) => b.share - a.share);
  // Each corrected record counts once, however many fields were changed.
  const corrected = new Set(overrides.map(o => o.touchId ?? o.replyId)).size;
  const total = aiTouches + aiReplies;
  return { nonStandard: people, nonStandardLimit: config.nonStandardShare,
    overrideRate: total ? corrected / total : null, overrideCorrected: corrected, overrideTotal: total, overrideLimit: config.overrideRate,
    overrideAlert: !!total && corrected / total > config.overrideRate };
}

/** Touches of one script (expanded from the ranking): salespeople see their own customers only. */
export async function scriptTouches(scriptId: string, user: Actor, input: unknown = {}) {
  z.string().trim().min(1).max(191).parse(scriptId);
  const query = dashboardQuery.parse(input);
  const script = await db.outreachScript.findUnique({ where: { id: scriptId }, select: { id: true, code: true, content: true, versionNote: true, status: true, position: true, language: true, grades: true } });
  if (!script) throw new HttpError(404, '话术不存在');
  const since = query.range === 'all' ? null : new Date(Date.now() - Number(query.range) * DAY);
  const touches = await db.outreachTouch.findMany({ where: { scriptId, judgeStatus: { not: 'VOID' }, customer: scope(user), ...(since ? { sentAt: { gte: since } } : {}),
    ...(query.grade !== 'ALL' ? { grade: query.grade } : {}) }, orderBy: { sentAt: 'desc' }, take: 200,
    select: { id: true, code: true, sentAt: true, channel: true, matchType: true, grade: true, replied24h: true, lateReply: true, replyQuality: true, repliedAt: true, senderId: true,
      customer: { select: { id: true, name: true, country: true } } } });
  const users = await db.user.findMany({ select: { id: true, name: true } });
  const names = new Map(users.map(u => [u.id, u.name]));
  return { script, touches: touches.map(t => ({ ...t, sender: t.senderId ? names.get(t.senderId) ?? '' : '' })) };
}

// ───────────────────────── Monday conclusion ─────────────────────────

export type ReportLine = { grade: string; text: string; scriptCode: string | null; suggestion: Suggestion | null; merged: boolean };
const weekStartKey = (now: Date, timezone: string) => dayKey(periodRange('WEEK', dayKey(now, timezone), timezone).start, timezone);

/**
 * One sentence per grade for every position with scripts under test, from all data before `until`, e.g. "A类：T0-A2
 * 回复率 38%（发送 34 条），胜出概率 93%，建议设为胜出。" The system only suggests; operations change the status.
 */
async function conclusionLines(until: Date, config: OutreachConfig): Promise<ReportLine[]> {
  const testing = await db.outreachScript.groupBy({ by: ['position'], where: { status: { in: ['TESTING', 'WINNER'] } }, _count: { _all: true } });
  const positions = testing.filter(p => p._count._all >= 2).map(p => p.position).sort();
  const lines: ReportLine[] = [];
  for (const position of positions) {
    const query = dashboardQuery.parse({ position, range: 'all' });
    const [rows, scripts] = await Promise.all([
      db.outreachTouch.findMany({ where: touchWhere(query, null, until), select: touchSelect }),
      db.outreachScript.findMany({ where: { position, status: { in: ['TESTING', 'WINNER'] } }, select: { id: true, code: true, status: true, content: true, versionNote: true, grades: true, language: true }, orderBy: { code: 'asc' } }),
    ]);
    for (const g of recommend(scripts, rows, config)) {
      const label = `${g.grade}类`;
      const best = g.recommended ? g.cells.find(c => c.scriptId === g.recommended)! : null;
      const code = (id: string) => scripts.find(s => s.id === id)!.code;
      if (!best) {
        const most = [...g.cells].sort((a, b) => b.matured - a.matured)[0];
        lines.push({ grade: g.grade, scriptCode: null, suggestion: 'INSUFFICIENT', merged: false,
          text: `${label}：${position} 数据不足${most ? `（最多的 ${code(most.scriptId)} 已满 24 小时 ${most.matured} 条，需 ${config.minSample} 条）` : ''}，继续轮换。` });
        continue;
      }
      if (g.merged) {
        lines.push({ grade: g.grade, scriptCode: code(best.scriptId), suggestion: null, merged: true,
          text: `${label}：本等级数据不足，参考 A+B 合并数据，${code(best.scriptId)} 领先，胜出概率 ${Math.round((g.mergedProbability ?? 0) * 100)}%（合并数据）。` });
        continue;
      }
      const verdict = best.suggestion === 'WIN' ? '建议设为胜出' : '继续测试';
      const retire = g.cells.filter(c => c.suggestion === 'RETIRE').map(c => `${code(c.scriptId)} 胜出概率 ${Math.round((c.probability ?? 0) * 100)}%，建议停用`);
      lines.push({ grade: g.grade, scriptCode: code(best.scriptId), suggestion: best.suggestion, merged: false,
        text: `${label}：${code(best.scriptId)} 回复率 ${best.rate ?? 0}%（发送 ${best.matured} 条），胜出概率 ${Math.round((best.probability ?? 0) * 100)}%，${verdict}。${retire.length ? `${retire.join('；')}。` : ''}` });
    }
  }
  return lines;
}

/**
 * The Monday report, once per week: from Monday 00:00 (business time zone) the first scheduled run writes last week's
 * conclusion, well before 09:00. Idempotent through the unique week key.
 */
export async function deliverWeeklyScriptReport(now = new Date()) {
  const { config, timezone } = await setup();
  const weekStart = weekStartKey(now, timezone);
  if (await db.outreachReport.findUnique({ where: { weekStart } })) return { generated: false, weekStart };
  const until = periodRange('WEEK', dayKey(now, timezone), timezone).start;
  const lines = await conclusionLines(until, config);
  try {
    await db.outreachReport.create({ data: { weekStart, lines, generatedAt: now } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { generated: false, weekStart };
    throw error;
  }
  return { generated: true, weekStart, lines: lines.length };
}
