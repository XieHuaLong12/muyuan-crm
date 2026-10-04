import { lockIdentity } from './contact-identity-service';
import { retryTransaction } from '@/lib/transaction-retry';
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
  const tasks = await tx.task.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } });
  // Match manual task updates: lock Task before Reminder, using primary keys.
  for (const task of tasks) {
    const changed = await tx.task.updateMany({ where: { id: task.id, status: { not: 'DONE' } }, data: { status: 'DONE', completedAt: new Date() } });
    if (changed.count) await tx.reminder.updateMany({ where: { taskId: task.id }, data: { status: 'DISMISSED' } });
  }
}
export async function syncCustomerWorkflow(customerId: string) {
  await retryTransaction(() => db.$transaction(async tx => {
    // Serialize this customer's rule creation across tabs and server processes.
    // Lock before snapshot reads so a waiter observes the previous commit.
    await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${customerId} FOR UPDATE`;
    const c = await tx.customer.findUnique({ where: { id: customerId } });
    if (!c) return;
    if (c.deletedAt || ['LOST','INVALID','PAUSED'].includes(c.stage)) {
      for (const rule of ['reply','quote','follow']) await resolveRule(tx,c.id,`${rule}:${c.id}:`);
      return;
    }
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
  }));
}
// Rule schedules are durable. The dedicated sync POST also brings older V2 customers into the task center.
const syncing = new Map<string, { at: number; work: Promise<void>; running: boolean }>();
export async function syncWorkflows(user: Actor) {
  const key = user.role === 'ADMIN' ? 'ADMIN' : user.id;
  const previous = syncing.get(key);
  if (previous && (previous.running || Date.now() - previous.at < 60000)) return previous.work;
  const work = syncAll(user);
  const entry = { at: Date.now(), work, running: true };
  syncing.set(key, entry);
  try { await work; entry.at = Date.now(); } catch (error) { syncing.delete(key); throw error; }
  finally { entry.running = false; }
}
async function syncAll(user: Actor) {
  const customers = await db.customer.findMany({ where: { ...scope(user), OR: [{ lastInboundAt: { not: null } }, { quotedAt: { not: null } }, { nextFollowUpAt: { not: null } }] }, select: { id: true } });
  for (const customer of customers.sort((a, b) => a.id.localeCompare(b.id))) await syncCustomerWorkflow(customer.id);
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
  await db.reminder.updateMany({ where: { taskId:r.taskId, remindAt:{lte:new Date()} }, data: { status: 'DISMISSED' } });
  return { dismissed: true };
}
export async function recordWorkflowEvent(input: unknown, user: Actor) {
  const v = z.object({ customerId: z.string().min(1), requestId: z.string().uuid(), kind: z.enum(['SAMPLE_SENT','PRODUCTION_STARTED','PAYMENT_DUE','CATALOG_SENT','PRODUCT_CONFIRMED','PAYMENT_RECEIVED','ORDER_COMPLETED']),
    expectedAt:z.string().datetime({offset:true}).optional(),description:z.string().max(3000).default('') }).superRefine((v,ctx)=>{if(['SAMPLE_SENT','PRODUCTION_STARTED','PAYMENT_DUE'].includes(v.kind)&&!v.expectedAt)ctx.addIssue({code:'custom',path:['expectedAt'],message:'请填写预计时间'});}).parse(input);
  const c = await accessible(v.customerId, user);
  const now=new Date(),expectedAt=v.expectedAt?new Date(v.expectedAt):null;
  if(expectedAt&&expectedAt<now) throw new HttpError(400, '预计时间不能早于现在');
  return retryTransaction(() => db.$transaction(async tx => {
    await lockIdentity(tx);
    const old = await tx.workflowEvent.findUnique({ where: { requestId: v.requestId } });
    if (old) { if (old.customerId !== c.id || old.kind !== v.kind || (old.expectedAt?.getTime()??null)!==(expectedAt?.getTime()??null) || old.description !== v.description) throw new HttpError(409, '请求编号已使用'); return old; }
    const event = await tx.workflowEvent.create({ data: { ...v, expectedAt, happenedAt: now, createdBy: user.id } });
    const add = (title: string, type: string, dueDate: Date, key: string) => automatedTask(tx, { customerId: c.id, createdBy: c.ownerId, title, type, dueDate,
      description: v.description, automationKey: `event:${event.id}:${key}` });
    if (v.kind === 'SAMPLE_SENT') await add('确认样品签收与使用反馈', 'SAMPLE', expectedAt!, 'sample');
    if (v.kind === 'PAYMENT_DUE') await add('确认客户付款与到账', 'PAYMENT', expectedAt!, 'payment');
    if (v.kind === 'PRODUCTION_STARTED') {
      await add('确认生产进度与交期', 'PRODUCTION', new Date(Math.min(now.getTime()+3*86400000, expectedAt!.getTime())), 'production');
      await add('出货前质检与包装确认', 'PRODUCTION', new Date(Math.max(now.getTime(),expectedAt!.getTime()-2*86400000)), 'inspection');
      await add('确认发货与物流追踪', 'SHIPPING', expectedAt!, 'shipping');
    }
    if(['CATALOG_SENT','PRODUCT_CONFIRMED'].includes(v.kind)){const current=await tx.customer.findUniqueOrThrow({where:{id:c.id}});const allowed=v.kind==='CATALOG_SENT'?['NEW','CONTACTED','REPLIED']:['NEW','CONTACTED','REPLIED','CATALOG_SENT','NEEDS_CONFIRMED'];if(allowed.includes(current.stage)){await tx.customer.update({where:{id:c.id},data:{stage:v.kind,stageSource:'HUMAN'}});await tx.stageHistory.create({data:{customerId:c.id,fromStage:current.stage,toStage:v.kind,changedBy:user.id,note:'人工登记业务事实'}});}}
    return event;
  }));
}
