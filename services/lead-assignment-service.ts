import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { retryTransaction } from '@/lib/transaction-retry';
import { automatedTask, initializeFirstContact, syncCustomerWorkflow } from './workflow-service';

type Tx = Prisma.TransactionClient;

export const LEAD_ASSIGN_MODES = { POOL: '进入待分配池，由管理员分配', ROUND_ROBIN: '按顺序轮流分给启用的销售' } as const;
export type LeadAssignMode = keyof typeof LEAD_ASSIGN_MODES;

/** Leads that arrive without a human choosing an owner. */
export type IntakeOwner = { ownerId: string; pending: boolean; explicit?: boolean };

/** The earliest active administrator holds pooled leads. Ordered so the choice never depends on the database. */
export async function intakeAdmin(tx: Tx | typeof db = db) {
  const admin = await tx.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, email: true, role: true },
  });
  if (!admin) throw new Error('没有启用的管理员账号，无法接收新线索');
  return admin;
}

/** Active salesperson whose most recent assignment is the oldest; never-assigned accounts go first. */
async function nextRoundRobinOwner(tx: Tx) {
  const sales = await tx.user.findMany({
    where: { role: 'SALES', isActive: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!sales.length) return null;
  const latest = await tx.customerAssignment.groupBy({
    by: ['toOwnerId'],
    where: { toOwnerId: { in: sales.map(user => user.id) } },
    _max: { assignedAt: true },
  });
  const lastAssigned = new Map(latest.map(row => [row.toOwnerId, row._max.assignedAt?.getTime() ?? 0]));
  let next = sales[0];
  for (const user of sales) if ((lastAssigned.get(user.id) ?? 0) < (lastAssigned.get(next.id) ?? 0)) next = user;
  return next.id;
}

/**
 * Decides the owner of an automatically created lead. Callers hold the identity lock, so round-robin
 * reads and the assignment write are serialized across webhooks and imports.
 */
export async function resolveIntakeOwner(tx: Tx, preferredOwnerEmail?: string | null): Promise<IntakeOwner> {
  if (preferredOwnerEmail?.trim()) {
    const preferred = await tx.user.findFirst({
      where: { email: preferredOwnerEmail.trim().toLowerCase(), isActive: true },
      select: { id: true, role: true },
    });
    // A configured salesperson is a real assignment; a configured administrator only holds the pool.
    if (preferred) return { ownerId: preferred.id, pending: preferred.role === 'ADMIN' };
  }
  const settings = await tx.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { leadAssignMode: true } });
  if (settings.leadAssignMode === 'ROUND_ROBIN') {
    const next = await nextRoundRobinOwner(tx);
    if (next) return { ownerId: next, pending: false };
  }
  return { ownerId: (await intakeAdmin(tx)).id, pending: true };
}

/** Records how an automatically created customer entered: pooled (no deadline yet) or assigned (deadline starts). */
export async function enterIntake(tx: Tx, customerId: string, actorId: string, intake: IntakeOwner, channel: string) {
  if (!intake.pending) {
    await initializeFirstContact(tx, customerId, actorId, null, `${channel}：${intake.explicit ? '指定负责人' : '自动分配'}`);
    return;
  }
  await tx.customer.update({ where: { id: customerId }, data: { pendingAssignment: true, assignedAt: null, firstContactDueAt: null } });
  await tx.customerAssignment.create({
    data: { customerId, fromOwnerId: null, toOwnerId: intake.ownerId, actorId, reason: `${channel}：进入待分配池` },
  });
}

const assignInput = z.object({
  ids: z.array(z.string().min(1).max(191)).min(1, '请选择客户').max(200, '单次最多分配 200 位客户'),
  ownerId: z.string().min(1, '请选择负责人').max(191),
  reason: z.string().trim().max(200, '原因最多 200 字').default(''),
});

/**
 * Assigns or transfers customers in one transaction. Only the owner changes: no other profile field is
 * rewritten, so a stale profile form can never undo an assignment and vice versa.
 */
export async function assignCustomers(input: unknown, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '只有管理员可以分配客户');
  const v = assignInput.parse(input);
  const ids = [...new Set(v.ids)].sort();
  const owner = await db.user.findFirst({ where: { id: v.ownerId, isActive: true }, select: { id: true, name: true } });
  if (!owner) throw new HttpError(400, '负责人不存在或账号已停用');
  const moved = await retryTransaction(() => db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM Customer WHERE id IN (${Prisma.join(ids)}) AND deletedAt IS NULL ORDER BY id FOR UPDATE`,
    );
    if (locked.length !== ids.length) throw new HttpError(409, '部分客户已删除或不存在，请刷新后重新选择');
    const customers = await tx.customer.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true, pendingAssignment: true } });
    const changed: string[] = [];
    for (const customer of customers.sort((a, b) => a.id.localeCompare(b.id))) {
      if (customer.ownerId === owner.id && !customer.pendingAssignment) continue;
      await tx.customer.update({ where: { id: customer.id }, data: { ownerId: owner.id } });
      const reason = v.reason || (customer.pendingAssignment ? '管理员从待分配池分配' : '管理员转交客户');
      await initializeFirstContact(tx, customer.id, user.id, customer.ownerId, reason);
      changed.push(customer.id);
    }
    return changed;
  }, { maxWait: 10000, timeout: 60000 }));
  for (const id of moved) await syncCustomerWorkflow(id);
  return { assigned: moved.length, unchanged: ids.length - moved.length, ownerId: owner.id, ownerName: owner.name };
}

export async function saveLeadAssignMode(input: unknown, user: Actor) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '需要管理员权限');
  const { mode } = z.object({ mode: z.enum(Object.keys(LEAD_ASSIGN_MODES) as [LeadAssignMode, ...LeadAssignMode[]]) }).parse(input);
  const saved = await db.setting.update({ where: { id: 'system' }, data: { leadAssignMode: mode }, select: { leadAssignMode: true } });
  return { mode: saved.leadAssignMode };
}

/**
 * An existing customer submitted another ad form: the current owner gets a high-priority contact task with
 * the ad-lead deadline. A disabled owner cannot act on it, so the customer returns to the pool instead.
 */
export async function flagRepeatSubmission(tx: Tx, customerId: string, info: { leadKey: string; formName: string | null; adName: string | null }, actorId: string) {
  const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, include: { owner: { select: { isActive: true } } } });
  if (c.deletedAt || c.pendingAssignment) return;
  if (!c.owner.isActive) {
    const admin = await intakeAdmin(tx);
    await tx.customer.update({ where: { id: customerId }, data: { ownerId: admin.id, pendingAssignment: true, assignedAt: null, firstContactDueAt: null } });
    await tx.customerAssignment.create({ data: { customerId, fromOwnerId: c.ownerId, toOwnerId: admin.id, actorId, reason: '负责人已停用，客户再次留资后进入待分配池' } });
    return;
  }
  const { adLeadFirstContactMinutes: minutes } = await tx.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { adLeadFirstContactMinutes: true } });
  await automatedTask(tx, {
    customerId, createdBy: c.ownerId, type: 'FOLLOW_UP', priority: 'HIGH',
    title: `${c.name} 再次留资`,
    description: `表单：${info.formName || '未知'}；广告：${info.adName || '未知'}。客户再次提交了广告表单，请在 ${minutes} 分钟内联系并记录跟进。`,
    dueDate: new Date(Date.now() + minutes * 60_000),
    automationKey: `resubmit:${customerId}:${info.leadKey}`,
  });
}
