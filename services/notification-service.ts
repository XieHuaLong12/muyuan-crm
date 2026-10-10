import { db } from '@/lib/db';
import { Actor } from '@/lib/auth';
import { sources } from '@/lib/constants';
import { getReminders } from './workflow-service';
import { firstContactFocus } from './sales-team-service';
import { TEST_LEAD_NOTE } from './meta-lead-service';
import { todayWorkCounts } from './bos-sales-service';

export type NotificationItem = {
  id: string;
  kind: 'POOL_LEAD' | 'ASSIGNED' | 'FIRST_CONTACT_OVERDUE' | 'REPEAT_SUBMISSION' | 'TASK_DUE' | 'TASK_OVERDUE' | 'LEAD_NEEDS_HUMAN';
  title: string;
  body: string;
  href: string;
  at: string;
  urgent: boolean;
};

const WINDOW_MS = 24 * 3600_000;
const sourceLabel = (source: string) => sources[source as keyof typeof sources] ?? source;

/**
 * One cheap feed the browser polls every ~20 seconds. Items carry stable ids so the client shows each
 * event once (in-page toast, sound, desktop notification), and counts drive the top-bar badges.
 */
export async function notificationFeed(user: Actor) {
  const admin = user.role === 'ADMIN';
  const now = new Date(), since = new Date(now.getTime() - WINDOW_MS);
  // Administrators see every reminder in the bell count, but are only interrupted for their own work:
  // other people's tasks are announced to the people who own them.
  const personal: Actor = { ...user, role: 'SALES' };
  const [settings, reminders, ownReminders, focus, assignments, poolRows, oldestPool, humanEvents, todayWork] = await Promise.all([
    db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { adLeadFirstContactMinutes: true } }),
    getReminders(user),
    admin ? getReminders(personal) : Promise.resolve(null),
    firstContactFocus(user),
    db.customerAssignment.findMany({
      where: { toOwnerId: user.id, actorId: { not: user.id }, assignedAt: { gte: since }, customer: { deletedAt: null, ownerId: user.id, pendingAssignment: false } },
      orderBy: { assignedAt: 'desc' }, take: 20,
      include: { customer: { select: { id: true, name: true, country: true, assignedAt: true, firstContactDueAt: true } } },
    }),
    admin ? db.customer.findMany({ where: { deletedAt: null, pendingAssignment: true, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, name: true, country: true, source: true, productInterest: true, createdAt: true } }) : Promise.resolve([]),
    admin ? db.customer.findFirst({ where: { deletedAt: null, pendingAssignment: true }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }) : Promise.resolve(null),
    admin ? db.metaLeadEvent.findMany({ where: { status: 'FAILED', createdAt: { gte: since }, OR: [{ error: { contains: 'AMBIGUOUS' } }, { error: { contains: '缺少可确认' } }] },
      orderBy: { createdAt: 'desc' }, take: 10, select: { leadgenId: true, error: true, createdAt: true } }) : Promise.resolve([]),
    // Salespeople see one number for today's work: the same count as the first tab of /sales.
    admin ? Promise.resolve({ today: 0, todayOverdue: 0 }) : todayWorkCounts(user, now),
  ]);
  const items: NotificationItem[] = [];
  for (const c of poolRows) {
    items.push({ id: `pool:${c.id}`, kind: 'POOL_LEAD', title: '新线索待分配', urgent: true, at: c.createdAt.toISOString(), href: '/customers?assign=pending',
      body: [c.name, c.country, sourceLabel(c.source), c.productInterest].filter(Boolean).join(' · ') });
  }
  for (const a of assignments) {
    const due = a.customer.firstContactDueAt, assigned = a.customer.assignedAt;
    const minutes = due && assigned && a.customer.assignedAt?.getTime() === a.assignedAt.getTime() ? Math.round((due.getTime() - assigned.getTime()) / 60000) : null;
    items.push({ id: `assign:${a.id}`, kind: 'ASSIGNED', title: '新分配客户', at: a.assignedAt.toISOString(), href: `/customers/${a.customer.id}`,
      urgent: minutes !== null && minutes <= 120,
      body: `${a.customer.name}${a.customer.country ? ` · ${a.customer.country}` : ''}${minutes === null ? '' : minutes <= 120 ? ` · 请在 ${minutes} 分钟内联系` : ' · 请按首联要求联系'}` });
  }
  for (const r of ownReminders ?? reminders) {
    const key = r.task.automationKey ?? '';
    const firstContact = key.startsWith('first-contact:'), repeat = key.startsWith('resubmit:');
    // A new assignment already announced itself; its first-contact reminder only matters once overdue.
    if (firstContact && r.kind === 'EARLY') continue;
    const kind: NotificationItem['kind'] = repeat ? 'REPEAT_SUBMISSION' : firstContact ? 'FIRST_CONTACT_OVERDUE' : r.kind === 'OVERDUE' ? 'TASK_OVERDUE' : 'TASK_DUE';
    const title = repeat ? (r.kind === 'OVERDUE' ? '再次留资的客户还没有联系' : '老客户再次留资') : firstContact ? '首次联系已超时' : r.kind === 'OVERDUE' ? '任务已到期' : '任务即将到期';
    items.push({ id: `reminder:${r.id}`, kind, title, at: r.remindAt.toISOString(), urgent: repeat || firstContact || r.kind === 'OVERDUE',
      href: r.task.customer ? `/customers/${r.task.customer.id}` : '/tasks', body: r.task.title });
  }
  for (const e of humanEvents) {
    const testLead = e.error.includes(TEST_LEAD_NOTE);
    items.push({ id: `lead-human:${e.leadgenId}`, kind: 'LEAD_NEEDS_HUMAN', title: testLead ? '收到 Meta 测试线索' : '广告线索需要人工处理', urgent: false, at: e.createdAt.toISOString(),
      href: '/growth/intake', body: testLead ? '接入已打通；测试工具的占位数据没有联系方式，不会建客户' : e.error.includes('AMBIGUOUS') ? '联系方式对应多个客户，请认领到正确的客户' : '线索缺少可确认的手机号或邮箱，请人工认领' });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return {
    at: now.toISOString(),
    adLeadMinutes: settings.adLeadFirstContactMinutes,
    counts: { reminders: reminders.length, pendingFirstContact: focus.pending, overdueFirstContact: focus.overdue, pool: focus.pool, poolOldestAt: oldestPool?.createdAt.toISOString() ?? null, ...todayWork },
    items,
  };
}
export type NotificationFeed = Awaited<ReturnType<typeof notificationFeed>>;
