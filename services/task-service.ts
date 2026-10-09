import { retryTransaction } from '@/lib/transaction-retry';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { accessible } from './customer-service';
import { dayKey, localDate } from '@/lib/time';

const taskInput = z.object({ customerId: z.string().min(1).max(191).nullable().default(null), title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(6000).default(''), type: z.enum(['FOLLOW_UP','QUOTATION','PAYMENT','SAMPLE','SHIPPING','PRODUCTION']).default('FOLLOW_UP'),
  priority: z.enum(['HIGH','MEDIUM','LOW']).default('MEDIUM'), status: z.enum(['TODO','DOING','DONE']).default('TODO'),
  dueDate: z.string().datetime({ offset: true }), reminderMinutes: z.number().int().min(0).max(10080).default(30) });
const patchInput = taskInput.partial().omit({ customerId: true }).extend({ updatedAt: z.string().datetime({ offset: true }).optional() });
export const taskInclude = { customer: { select: { id: true, name: true, country: true } }, reminders: true } as const;
export function taskScope(user: Actor): Prisma.TaskWhereInput {
  return user.role === 'ADMIN' ? { deletedAt: null, OR: [{ customerId: null }, { customer: { deletedAt: null } }] }
    : { deletedAt: null, OR: [{ customerId: null, createdBy: user.id }, { customer: scope(user) }] };
}
export async function taskReminders(tx: Prisma.TransactionClient, taskId: string, dueDate: Date, minutes: number, done = false) {
  for (const kind of ['EARLY', 'OVERDUE']) {
    const remindAt = kind === 'EARLY' ? new Date(dueDate.getTime() - minutes * 60000) : dueDate;
    await tx.reminder.upsert({ where: { taskId_kind: { taskId, kind } },
      create: { taskId, kind, remindAt, status: done ? 'DISMISSED' : 'PENDING' },
      update: { remindAt, status: done ? 'DISMISSED' : 'PENDING' } });
  }
}
export async function createTask(input: unknown, user: Actor) {
  const v = taskInput.parse(input);
  if (v.customerId) await accessible(v.customerId, user);
  return retryTransaction(() => db.$transaction(async tx => {
    const task = await tx.task.create({ data: { ...v, dueDate: new Date(v.dueDate), createdBy: user.id, completedAt: v.status === 'DONE' ? new Date() : null } });
    await taskReminders(tx, task.id, task.dueDate, task.reminderMinutes, task.status === 'DONE');
    return tx.task.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
  }));
}
export async function updateTask(id: string, input: unknown, user: Actor) {
  const { updatedAt, ...v } = patchInput.parse(input);
  return retryTransaction(() => db.$transaction(async tx => {
    const old = await tx.task.findFirst({ where: { id, ...taskScope(user) } });
    if (!old) throw new HttpError(404, '任务不存在或无访问权限');
    const status = v.status || old.status;
    const result = await tx.task.updateMany({ where: { id, ...taskScope(user), updatedAt: updatedAt ? new Date(updatedAt) : old.updatedAt },
      data: { ...v, dueDate: v.dueDate ? new Date(v.dueDate) : undefined,
        completedAt: status === 'DONE' ? old.completedAt || new Date() : null } });
    if (!result.count) throw new HttpError(409, '任务已更新，请刷新后重试');
    if (v.dueDate || v.reminderMinutes !== undefined || status !== old.status) {
      await taskReminders(tx, id, v.dueDate ? new Date(v.dueDate) : old.dueDate, v.reminderMinutes ?? old.reminderMinutes, status === 'DONE');
    }
    if(status==='DONE'&&old.status!=='DONE'&&old.customerId&&old.automationKey?.startsWith('first-contact:'))await (await import('./workflow-service')).recordFirstContact(tx,old.customerId,new Date(),user.id);
    return tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
  }));
}
export async function deleteTask(id: string, user: Actor) {
  const result = await db.task.deleteMany({ where: { id, ...taskScope(user), source: 'MANUAL' } });
  if (result.count) return { deleted: true };
  // Keep automation keys as tombstones so deleted generated tasks cannot reappear.
  const old = await db.task.findFirst({ where: { id, ...taskScope(user) } });
  if (!old) throw new HttpError(404, '任务不存在或无访问权限');
  await updateTask(id, { status: 'DONE' }, user);
  await db.task.update({ where: { id }, data: { deletedAt: new Date() } });
  return { deleted: true };
}
export async function listTasks(user: Actor, query: { status?: string; view?: string; customerId?: string; cursor?: string } = {}) {
  const where: Prisma.TaskWhereInput = { ...taskScope(user) };
  if (query.customerId) { await accessible(query.customerId, user); where.customerId = query.customerId; }
  if (query.status && query.status !== 'ALL') where.status = query.status === 'OPEN' ? { not: 'DONE' } : z.enum(['TODO','DOING','DONE']).parse(query.status);
  const settings = await db.setting.findUniqueOrThrow({ where: { id: 'system' } });
  const today = dayKey(new Date(), settings.timezone);
  const next = new Date(`${today}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  if (query.view === 'TODAY') where.dueDate = { gte: localDate(`${today}T00:00`, settings.timezone), lt: localDate(`${next.toISOString().slice(0,10)}T00:00`, settings.timezone) };
  if (query.view === 'OVERDUE') { where.dueDate = { lt: new Date() }; where.status = { not: 'DONE' }; }
  if (query.cursor && !await db.task.findFirst({ where: { id: query.cursor, ...where } })) throw new HttpError(400, '分页位置无效');
  const [rows, total] = await Promise.all([db.task.findMany({ where, include: taskInclude, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 101,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) }), db.task.count({ where })]);
  const tasks = rows.slice(0,100);
  return { tasks, total, nextCursor: rows.length > 100 ? tasks.at(-1)!.id : null };
}
