import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { AD_LEAD_FRESH_HOURS, sources } from '@/lib/constants';
import { ringFor } from '@/lib/lead-grade';
import { gradeLead } from './lead-grade-service';
import { sendPush, type PushMessage } from './push-service';

type Tx = Prisma.TransactionClient;
export type LeadAlertKind = 'NEW' | 'ASSIGNED' | 'REPEAT';

/**
 * Written in the same transaction that creates or assigns the lead, so an alert can never be lost or sent for a
 * lead that was rolled back. NEW goes to every administrator; ASSIGNED and REPEAT go to `recipientId`.
 */
export async function queueLeadAlert(tx: Tx, customerId: string, kind: LeadAlertKind, recipientId: string | null = null) {
  await tx.leadAlert.create({ data: { customerId, kind, recipientId } });
}

const sourceLabel = (source: string) => sources[source as keyof typeof sources] ?? source;

/**
 * Grades fresh leads, then pushes each queued alert to phones and desktops. Runs right after the webhook or
 * assignment response, and again from the scheduled jobs and the in-app sync as a safety net. Each alert is
 * claimed before sending, so concurrent runs never push the same alert twice.
 */
export async function deliverLeadAlerts(options: { gradeTimeoutMs?: number } = {}) {
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const pending = await db.leadAlert.findMany({ where: { sentAt: null, createdAt: { gte: dayAgo } }, orderBy: { createdAt: 'asc' }, take: 50 });
  const claimed: typeof pending = [];
  for (const alert of pending) {
    const claim = await db.leadAlert.updateMany({ where: { id: alert.id, sentAt: null }, data: { sentAt: new Date() } });
    if (claim.count) claimed.push(alert);
  }
  // Alerts only matter for a day; keep a month for the record, then let them go.
  await db.leadAlert.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 24 * 3600_000) } } });
  if (!claimed.length) return { alerts: 0, pushed: 0 };

  // New forms are graded before anyone is alerted, so the alert says how good the lead is. A repeat submission
  // brings new answers, so it is graded again.
  const toGrade = [...new Set(claimed.filter(a => a.kind === 'REPEAT' || a.kind === 'NEW').map(a => a.customerId))];
  const ungraded = new Set((await db.customer.findMany({ where: { id: { in: toGrade }, leadGrade: '' }, select: { id: true } })).map(c => c.id));
  await Promise.all(toGrade.filter(id => ungraded.has(id) || claimed.some(a => a.kind === 'REPEAT' && a.customerId === id))
    .map(id => gradeLead(id, { timeoutMs: options.gradeTimeoutMs }).catch(() => null)));

  const customers = new Map((await db.customer.findMany({
    where: { id: { in: [...new Set(claimed.map(a => a.customerId))] }, deletedAt: null },
    select: { id: true, name: true, country: true, source: true, productInterest: true, leadGrade: true, leadGradeReason: true, pendingAssignment: true, inquiryAt: true, createdAt: true, firstContactDueAt: true, assignedAt: true },
  })).map(c => [c.id, c]));
  const admins = (await db.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })).map(u => u.id);
  const fresh = (at: Date) => Date.now() - at.getTime() < AD_LEAD_FRESH_HOURS * 3600_000;

  const outbox: { to: string[]; message: PushMessage }[] = [];
  const assignedTo = new Map<string, string[]>();
  for (const alert of claimed) {
    const c = customers.get(alert.customerId);
    if (!c) continue;
    const grade = c.leadGrade ? `${c.leadGrade} 级` : '';
    const details = [c.name, c.country, c.leadGradeReason || [sourceLabel(c.source), c.productInterest].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
    const urgent = ringFor(c.leadGrade) === 'loop';
    if (alert.kind === 'NEW') {
      // Backfilled old submissions are recorded quietly, and a D lead (test data, no contact) does not ring anyone.
      if (!fresh(c.inquiryAt ?? c.createdAt) || c.leadGrade === 'D') continue;
      outbox.push({ to: admins, message: { title: `${grade}新线索${c.pendingAssignment ? ' · 待分配' : ''}`, body: details, urgent,
        href: c.pendingAssignment ? '/customers?assign=pending' : `/customers/${c.id}`, tag: `lead:${c.id}` } });
    } else if (alert.kind === 'REPEAT' && alert.recipientId) {
      outbox.push({ to: [alert.recipientId], message: { title: `老客户再次留资${grade ? ` · ${grade}` : ''}`, body: details, urgent: true, href: `/customers/${c.id}`, tag: `repeat:${c.id}` } });
    } else if (alert.kind === 'ASSIGNED' && alert.recipientId) {
      assignedTo.set(alert.recipientId, [...(assignedTo.get(alert.recipientId) ?? []), c.id]);
    }
  }
  for (const [recipient, ids] of assignedTo) {
    // An administrator who also got the NEW alert for this lead does not need a second one.
    const own = ids.filter(id => !(admins.includes(recipient) && claimed.some(a => a.kind === 'NEW' && a.customerId === id)));
    if (!own.length) continue;
    if (own.length > 3) {
      outbox.push({ to: [recipient], message: { title: `新分配 ${own.length} 位客户`, body: own.slice(0, 3).map(id => customers.get(id)!.name).join('、') + ' 等，请尽快首次联系', href: '/sales?queue=new', tag: `assign-batch:${Date.now()}`, urgent: true } });
      continue;
    }
    for (const id of own) {
      const c = customers.get(id)!;
      const minutes = c.firstContactDueAt && c.assignedAt ? Math.round((c.firstContactDueAt.getTime() - c.assignedAt.getTime()) / 60_000) : null;
      outbox.push({ to: [recipient], message: { title: `新分配客户${c.leadGrade ? ` · ${c.leadGrade} 级` : ''}`, urgent: true, href: `/customers/${c.id}`, tag: `assign:${c.id}`,
        body: [c.name, c.country, minutes !== null && minutes <= 120 ? `请在 ${minutes} 分钟内联系` : c.leadGradeReason].filter(Boolean).join(' · ') } });
    }
  }
  let pushed = 0;
  for (const { to, message } of outbox) pushed += (await sendPush(to, message)).sent;
  return { alerts: claimed.length, pushed };
}
