import { formatInTimeZone } from 'date-fns-tz';
import { TERMINAL_STAGES } from './constants';

/**
 * 待处理 (消息页): the customers worth handling now, and why. services/todo-service.ts selects them with the same
 * rules in the database; here each one gets its reasons and its group. docs/MESSAGE_CENTER.md「销售阶段、客户标签与待处理」.
 *
 * 1. An A or B lead whose first-contact deadline has passed with nobody having reached out.
 * 2. An A or B, or high-intent, customer waiting for our answer (their message is the newest).
 * 3. A follow-up a person scheduled, or a task a person created, due today or earlier.
 * 4. A quotation sent more than three days ago without contact since (lib/metrics staleQuotes).
 * 5. A customer someone marked 待处理 by hand, from the time they chose.
 * Rules 1–4 cover active 新客户 only, like the other work queues; a hand mark counts for any customer.
 */
export const TODO_GROUPS = { LATE: '已超时', TODAY: '今天要做', MINE: '我标记的' } as const;
export type TodoGroup = keyof typeof TODO_GROUPS;
export const GOOD_GRADES = ['A', 'B'] as const;
export const STALE_QUOTE_MS = 3 * 86400_000;

export type TodoFacts = {
  stage: string; legacy: boolean; leadGrade: string; aiIntent: string; bestReplyQuality: string;
  firstContactDueAt: Date | null; firstContactAt: Date | null; contactedAt: Date | null;
  lastInboundAt: Date | null; lastOutboundAt: Date | null; lastFollowUpAt: Date | null; lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  /** The earliest open task a person created, due before the end of today. */
  task: { title: string; dueDate: Date } | null;
  /** The oldest sent quotation that has gone quiet. */
  staleQuoteSentAt: Date | null;
  mark: { note: string; dueAt: Date } | null;
};

export const isHighIntent = (c: Pick<TodoFacts, 'bestReplyQuality' | 'aiIntent'>) => c.bestReplyQuality === 'HIGH' || c.aiIntent === 'HIGH';
const good = (grade: string) => (GOOD_GRADES as readonly string[]).includes(grade);
export const span = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.round(minutes / 60)} 小时` : `${Math.round(minutes / 1440)} 天`;
};

/**
 * Why a customer is in 待处理, most pressing first, and the group it shows under: 已超时 when any deadline has
 * passed (a first contact, a scheduled follow-up or task, or a good customer waiting longer than `hotHours`),
 * else 今天要做, else (only a hand mark) 我标记的. Empty when the customer does not belong there.
 */
export function todoReasons(c: TodoFacts, now: Date, endOfToday: Date, timezone: string, hotHours: number): { group: TodoGroup; reasons: string[] } | null {
  const late: string[] = [], today: string[] = [];
  const auto = !c.legacy && !(TERMINAL_STAGES as readonly string[]).includes(c.stage);
  const at = (date: Date) => formatInTimeZone(date, timezone, 'HH:mm');
  if (auto) {
    const untouched = !c.firstContactAt && !c.contactedAt && !c.lastOutboundAt && !c.lastFollowUpAt;
    if (good(c.leadGrade) && untouched && c.firstContactDueAt && c.firstContactDueAt < now) late.push(`${c.leadGrade} 级 · 首联已超时 ${span(now.getTime() - c.firstContactDueAt.getTime())}`);
    const answered = Math.max(c.lastOutboundAt?.getTime() ?? 0, c.lastFollowUpAt?.getTime() ?? 0);
    if (c.lastInboundAt && c.lastInboundAt.getTime() > answered && (good(c.leadGrade) || isHighIntent(c))) {
      const who = [good(c.leadGrade) ? `${c.leadGrade} 级` : '', isHighIntent(c) ? '高意向' : ''].filter(Boolean).join(' · ');
      const waited = now.getTime() - c.lastInboundAt.getTime();
      (waited > hotHours * 3600_000 ? late : today).push(`${who} · 客户在等你回复 ${span(waited)}`);
    }
    if (c.nextFollowUpAt && c.nextFollowUpAt < endOfToday) {
      if (c.nextFollowUpAt < now) late.push(`约好的跟进已过 ${span(now.getTime() - c.nextFollowUpAt.getTime())}`);
      else today.push(`约好今天 ${at(c.nextFollowUpAt)} 跟进`);
    }
    if (c.task && c.task.dueDate < endOfToday) (c.task.dueDate < now ? late : today).push(`任务「${c.task.title}」${c.task.dueDate < now ? '已过期' : `今天 ${at(c.task.dueDate)} 到期`}`);
    if (c.staleQuoteSentAt && now.getTime() - c.staleQuoteSentAt.getTime() > STALE_QUOTE_MS
      && (!c.lastContactAt || now.getTime() - c.lastContactAt.getTime() > STALE_QUOTE_MS)) today.push(`报价发出 ${span(now.getTime() - c.staleQuoteSentAt.getTime())}没回音`);
  }
  const mine = c.mark && c.mark.dueAt <= now ? [c.mark.note ? `提醒：${c.mark.note}` : '你标记的待处理'] : [];
  const reasons = [...late, ...today, ...mine];
  if (!reasons.length) return null;
  return { group: late.length ? 'LATE' : today.length ? 'TODAY' : 'MINE', reasons };
}
