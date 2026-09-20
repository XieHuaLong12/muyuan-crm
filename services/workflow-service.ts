import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { accessible } from './customer-service';
import { taskReminders, taskScope, taskInclude } from './task-service';

export async function automatedTask(tx: Prisma.TransactionClient, data: { customerId: string; createdBy: string; title: string; description?: string; type: string; dueDate: Date; automationKey: string; priority?: string; source?: string }) {
  const task = await tx.task.upsert({ where: { automationKey: data.automationKey }, update: {},
    create: { ...data, description: data.description || '', priority: data.priority || 'MEDIUM', source: data.source || 'WORKFLOW' } });
  if (task.status !== 'DONE' && !await tx.reminder.findFirst({ where: { taskId: task.id } })) await taskReminders(tx, task.id, task.dueDate, 30);
  return task;
}
async function resolveRule(tx: Prisma.TransactionClient, customerId: string, prefix: string, activeKey?: string) {
  const where = { customerId, status: { not: 'DONE' }, automationKey: { startsWith: prefix, ...(activeKey ? { not: activeKey } : {}) } };
  await tx.reminder.updateMany({ where: { task: where }, data: { status: 'DISMISSED' } });
  await tx.task.updateMany({ where, data: { status: 'DONE', completedAt: new Date() } });
}
export async function syncCustomerWorkflow(customerId: string) {
  await db.$transaction(async tx => {
    const c = await tx.customer.findUnique({ where: { id: customerId } });
    if (!c || c.deletedAt || ['LOST','INVALID','PAUSED'].includes(c.stage)) return;
    const needsReply = c.lastInboundAt && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt);
    const replyKey = needsReply ? `reply:${c.id}:${c.lastInboundAt!.getTime()}` : undefined;
    await resolveRule(tx, c.id, `reply:${c.id}:`, replyKey);
    if (replyKey) await automatedTask(tx, { customerId: c.id, createdBy: c.ownerId, title: `回复 ${c.name}`, type: 'FOLLOW_UP', priority: 'HIGH',
      description: '客户消息等待回复，请在 24 小时内处理。', dueDate: new Date(c.lastInboundAt!.getTime() + 86400000), automationKey: replyKey });
    const quote = await tx.quotation.findFirst({ where: { customerId: c.id, status: 'SENT' }, orderBy: { sentAt: 'desc' } });
    const quoteAt = quote?.sentAt || (c.quotedAt && c.lastOutboundAt && c.lastOutboundAt >= c.quotedAt ? c.quotedAt : null);
    const quoteKey = quoteAt && (!c.lastInboundAt || c.lastInboundAt < quoteAt) && c.stage !== 'WON' ? `quote:${c.id}:${quoteAt.getTime()}` : undefined;
    await resolveRule(tx, c.id, `quote:${c.id}:`, quoteKey);
    if (quoteKey) await automatedTask(tx, { customerId: c.id, createdBy: c.ownerId, title: `跟进 ${c.name} 的报价`, type: 'QUOTATION',
      description: '报价后 3 天未收到回复，确认客户反馈与下一步。', dueDate: new Date(quoteAt!.getTime() + 3*86400000), automationKey: quoteKey });
    const followKey = c.nextFollowUpAt ? `follow:${c.id}:${c.nextFollowUpAt.getTime()}` : undefined;
    await resolveRule(tx, c.id, `follow:${c.id}:`, followKey);
    if (followKey) await automatedTask(tx, { customerId: c.id, createdBy: c.ownerId, title: `跟进 ${c.name}`, type: 'FOLLOW_UP',
      description: '来自客户的下次跟进安排。', dueDate: c.nextFollowUpAt!, automationKey: followKey });
  });
}
// Rule schedules are durable. Viewing the workspace also brings older V2 customers into the task center.
const syncing = new Map<string, { at: number; work: Promise<void> }>();
export async function syncWorkflows(user: Actor) {
  const key = user.role === 'ADMIN' ? 'ADMIN' : user.id;
  const previous = syncing.get(key);
  if (previous && Date.now() - previous.at < 60000) return previous.work;
  const work = syncAll(user);
  syncing.set(key, { at: Date.now(), work });
  try { await work; } catch (error) { syncing.delete(key); throw error; }
}
async function syncAll(user: Actor) {
  const customers = await db.customer.findMany({ where: { ...scope(user), OR: [{ lastInboundAt: { not: null } }, { quotedAt: { not: null } }, { nextFollowUpAt: { not: null } }] }, select: { id: true } });
  for (let i = 0; i < customers.length; i += 4) await Promise.all(customers.slice(i,i+4).map(c => syncCustomerWorkflow(c.id)));
}
export async function getReminders(user: Actor) {
  const now = new Date();
  const rows = await db.reminder.findMany({ where: { status: 'PENDING', remindAt: { lte: now }, task: { ...taskScope(user), status: { not: 'DONE' } } },
    include: { task: { include: taskInclude } }, orderBy: { remindAt: 'asc' }, take: 100 });
  const byTask = new Map<string, typeof rows[number]>();
  for (const r of rows) if (!byTask.has(r.taskId) || r.kind === 'OVERDUE') byTask.set(r.taskId, r);
  return [...byTask.values()];
}
export async function dismissReminder(id: string, user: Actor) {
  const r = await db.reminder.findFirst({ where: { id, task: taskScope(user) } });
  if (!r) throw new HttpError(404, '提醒不存在');
  await db.reminder.update({ where: { id }, data: { status: 'DISMISSED' } });
  return { dismissed: true };
}
export async function recordWorkflowEvent(input: unknown, user: Actor) {
  const v = z.object({ customerId: z.string().min(1), requestId: z.string().uuid(), kind: z.enum(['SAMPLE_SENT','PRODUCTION_STARTED','PAYMENT_DUE']),
    expectedAt: z.string().datetime({ offset: true }), description: z.string().max(3000).default('') }).parse(input);
  const c = await accessible(v.customerId, user);
  const now = new Date(), expectedAt = new Date(v.expectedAt);
  if (expectedAt < now) throw new HttpError(400, '预计时间不能早于现在');
  return db.$transaction(async tx => {
    const old = await tx.workflowEvent.findUnique({ where: { requestId: v.requestId } });
    if (old) { if (old.customerId !== c.id) throw new HttpError(409, '请求编号已使用'); return old; }
    const event = await tx.workflowEvent.create({ data: { ...v, expectedAt, happenedAt: now, createdBy: user.id } });
    const add = (title: string, type: string, dueDate: Date, key: string) => automatedTask(tx, { customerId: c.id, createdBy: c.ownerId, title, type, dueDate,
      description: v.description, automationKey: `event:${event.id}:${key}` });
    if (v.kind === 'SAMPLE_SENT') await add('确认样品签收与使用反馈', 'SAMPLE', expectedAt, 'sample');
    if (v.kind === 'PAYMENT_DUE') await add('确认客户付款与到账', 'PAYMENT', expectedAt, 'payment');
    if (v.kind === 'PRODUCTION_STARTED') {
      await add('确认生产进度与交期', 'PRODUCTION', new Date(Math.min(now.getTime()+3*86400000, expectedAt.getTime())), 'production');
      await add('出货前质检与包装确认', 'PRODUCTION', new Date(Math.max(now.getTime(),expectedAt.getTime()-2*86400000)), 'inspection');
      await add('确认发货与物流追踪', 'SHIPPING', expectedAt, 'shipping');
    }
    return event;
  });
}
