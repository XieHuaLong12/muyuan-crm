import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { smartPriority, priorityReason, TASK_SOURCES, TASK_PRIORITIES, TASK_STATUS } from '@/lib/task-meta';
import { taskScope,updateTask } from './task-service';
import { dayKey, localDate } from '@/lib/time';
import { overdueTasks, staleQuotes } from '@/lib/metrics';

/**
 * AI 经营行动中心（AI Action Center）
 *
 * 定位：不是待办清单，而是**连接 CRM + 订单 + 财务 + AI 的建议**的执行中心。
 * 每个任务都能追溯到业务对象（客户 / 订单），并说明「为什么出现」。
 *
 * 说明：AI 建议这里是**基于可验证数据的规则推导**，不调用大模型编造理由 ——
 * 与系统既有的 AI 原则一致（只呈现可核对的依据）。
 */

const DAY = 86_400_000;

export const actionQuery = z.object({
  view: z.enum(['ALL', 'TODAY', 'HIGH', 'OVERDUE', 'DONE']).default('TODAY'),
  source: z.enum(['ALL', 'CRM', 'ORDER', 'FINANCE', 'ADS', 'AI', 'MANUAL','WORKFLOW']).default('ALL'),
  q: z.string().trim().max(100).default(''),
});

/** Midnight of the current day in the company time zone. */
function startOfToday(timezone: string) {
  return localDate(`${dayKey(new Date(), timezone)}T00:00`, timezone);
}

function viewWhere(view: string, timezone: string): Prisma.TaskWhereInput {
  const now = new Date();
  const today = startOfToday(timezone);
  switch (view) {
    case 'TODAY':
      return { status: { not: 'DONE' }, dueDate: { lt: new Date(today.getTime() + DAY) } };
    case 'HIGH':
      return { status: { not: 'DONE' }, priority: 'HIGH' };
    case 'OVERDUE':
      return { status: { not: 'DONE' }, dueDate: { lt: now } };
    case 'DONE':
      return { status: 'DONE' };
    default:
      return {};
  }
}

/** 把一个任务补全为「带业务背景」的卡片数据。 */
type TaskRow = Prisma.TaskGetPayload<{
  include: {
    customer: { select: { id: true; name: true; companyName: true; country: true; stage: true; whatsapp: true; owner: { select: { name: true } } } };
    order: { select: { id: true; orderNo: true; amountRMB: true; status: true } };
  };
}>;

function present(task: TaskRow) {
  const overdue = task.status !== 'DONE' && task.dueDate < new Date();
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    source: task.source,
    sourceLabel: TASK_SOURCES[task.source as keyof typeof TASK_SOURCES]?.label ?? task.source,
    priority: task.priority,
    priorityLabel: TASK_PRIORITIES[task.priority as keyof typeof TASK_PRIORITIES]?.label ?? task.priority,
    priorityMark: TASK_PRIORITIES[task.priority as keyof typeof TASK_PRIORITIES]?.mark ?? '',
    status: task.status,
    statusLabel: TASK_STATUS[task.status as keyof typeof TASK_STATUS] ?? task.status,
    dueDate: task.dueDate.toISOString(),
    overdue,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    // 业务背景：客户 / 国家 / 阶段 / 订单 / 金额
    customer: task.customer
      ? { id: task.customer.id, name: task.customer.name, companyName: task.customer.companyName, country: task.customer.country, stage: task.customer.stage, whatsapp: task.customer.whatsapp }
      : null,
    order: task.order ? { id: task.order.id, orderNo: task.order.orderNo, amountRMB: task.order.amountRMB.toFixed(2), status: task.order.status } : null,
    // 执行人：客户任务归客户当前负责人；个人任务归指定执行人，未指定时归创建人。
    responsibleName: task.customer?.owner.name ?? null,
    assigneeId: task.assigneeId ?? (task.customer ? null : task.createdBy),
    amount: task.amount ? task.amount.toFixed(2) : null,
    // 为什么出现这个任务
    aiReason: task.aiReason ?? '',
  };
}

const include = {
  customer: { select: { id: true, name: true, companyName: true, country: true, stage: true, whatsapp: true, owner: { select: { name: true } } } },
  order: { select: { id: true, orderNo: true, amountRMB: true, status: true } },
} as const;

/** 首页聚合：统计卡 + AI 今日建议 + 任务列表 + 执行效率。 */
export async function actionCenter(user: Actor, input: unknown = {}) {
  const query = actionQuery.parse(input);
  const base = taskScope(user);
  const now = new Date();
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const today = startOfToday(timezone);
  const weekAgo = new Date(now.getTime() - 7 * DAY);

  const [todayCount, highCount, overdueCount, doneCount, tasks, doneThisWeek, aiTotal, aiDone, recommendations] = await Promise.all([
    db.task.count({ where: { ...base, status: { not: 'DONE' }, dueDate: { lt: new Date(today.getTime() + DAY) } } }),
    db.task.count({ where: { ...base, status: { not: 'DONE' }, priority: 'HIGH' } }),
    db.task.count({ where: overdueTasks(now, base) }),
    db.task.count({ where: { ...base, status: 'DONE', completedAt: { gte: today } } }),
    db.task.findMany({
      where: {
        AND: [base, viewWhere(query.view, timezone),
          ...(query.source === 'ALL' ? [] : [{ source: query.source }]),
          ...(query.q ? [{ OR: [{ title: { contains: query.q } }, { customer: { name: { contains: query.q } } }] }] : []),
        ],
      },
      include,
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
      take: 60,
    }),
    db.task.findMany({ where: { ...base, status: 'DONE', completedAt: { gte: weekAgo } }, select: { createdAt: true, completedAt: true, amount: true, source: true } }),
    db.task.count({ where: { ...base, source: 'AI' } }),
    db.task.count({ where: { ...base, source: 'AI', status: 'DONE' } }),
    recommend(user),
  ]);

  const durations = doneThisWeek.filter(t => t.completedAt).map(t => t.completedAt!.getTime() - t.createdAt.getTime());
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  return {
    query,
    stats: { today: todayCount, high: highCount, overdue: overdueCount, done: doneCount },
    recommendations,
    tasks: tasks.map(present),
    performance: {
      doneThisWeek: doneThisWeek.length,
      // 平均响应：从建单到完成的中位耗时，界面按小时/天展示
      avgResponseMs: Math.round(avgMs),
      dealRelated: doneThisWeek.filter(t => t.amount && t.amount.greaterThan(0)).length,
      aiAdoption: aiTotal ? Math.round((aiDone / aiTotal) * 100) : 0,
      aiTotal,
      aiDone,
    },
  };
}

export type Recommendation = {
  id: string;
  rank: number;
  kind: 'QUOTE' | 'PAYMENT' | 'REPLY' | 'RISK';
  mark: string;
  title: string;
  reason: string;
  amount: string | null;
  customerId: string | null;
  customerName: string | null;
  country: string | null;
  orderId: string | null;
};

/**
 * AI 今日建议：从客户、订单、财务数据里推导今天最该做的事。
 *
 * 每条建议都给出**可核对的依据**（多少天未回复、订单状态、逾期几天），
 * 不生成无法验证的推荐理由。
 */
async function recommend(user: Actor): Promise<Recommendation[]> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - DAY);
  const out: Omit<Recommendation, 'rank' | 'id'>[] = [];

  const [quotes, awaitingPayment, inbound, risky] = await Promise.all([
    // ① 报价发出 3 天以上、客户仍在推进中且之后没有联系（与驾驶舱「报价超时」同一口径）
    db.quotation.findMany({
      where: staleQuotes(now, scope(user)),
      select: { id: true, customerId: true, unitPrice: true, quantity: true, currency: true, sentAt: true, customer: { select: { name: true, country: true } } },
      orderBy: { sentAt: 'asc' },
      take: 2,
    }),
    // ② 订单已生产完成但尾款未收
    db.order.findMany({
      where: { customer: scope(user), paymentStatus: 'DEPOSIT_PAID', status: { notIn: ['CANCELLED', 'COMPLETED'] } },
      select: { id: true, orderNo: true, amountRMB: true, status: true, customerId: true, customer: { select: { name: true, country: true } } },
      orderBy: { amountRMB: 'desc' },
      take: 2,
    }),
    // ③ 客户来过消息但超过 24 小时未回
    db.customer.findMany({
      where: { ...scope(user), lastInboundAt: { lt: dayAgo }, AND: [
        { OR: [{ lastOutboundAt: null }, { lastInboundAt: { gt: db.customer.fields.lastOutboundAt } }] },
        { OR: [{ lastFollowUpAt: null }, { lastInboundAt: { gt: db.customer.fields.lastFollowUpAt } }] },
      ] },
      select: { id: true, name: true, country: true },
      take: 1,
    }),
    // ④ 运输中但预计到货已过
    db.order.findMany({
      where: { customer: scope(user), status: 'IN_TRANSIT', estimatedDelivery: { lt: now } },
      select: { id: true, orderNo: true, amountRMB: true, estimatedDelivery: true, customerId: true, customer: { select: { name: true, country: true } } },
      take: 1,
    }),
  ]);

  for (const q of quotes) {
    const days = Math.floor((now.getTime() - (q.sentAt?.getTime() ?? now.getTime())) / DAY);
    out.push({
      kind: 'QUOTE',
      mark: '🔥',
      title: `跟进 ${q.customer.name} 的报价`,
      reason: `报价后 ${days} 天未回复`,
      amount: q.unitPrice.mul(q.quantity).toFixed(2),
      customerId: q.customerId,
      customerName: q.customer.name,
      country: q.customer.country,
      orderId: null,
    });
  }
  for (const o of awaitingPayment) {
    out.push({
      kind: 'PAYMENT',
      mark: '🔥',
      title: `确认 ${o.customer.name} 尾款`,
      reason: `订单 ${o.orderNo} 已付定金，尾款未收`,
      amount: o.amountRMB.toFixed(2),
      customerId: o.customerId,
      customerName: o.customer.name,
      country: o.customer.country,
      orderId: o.id,
    });
  }
  for (const c of inbound) {
    out.push({
      kind: 'REPLY',
      mark: '⚠️',
      title: `回复 ${c.name}`,
      reason: '客户发来消息超过 24 小时未回复',
      amount: null,
      customerId: c.id,
      customerName: c.name,
      country: c.country,
      orderId: null,
    });
  }
  for (const o of risky) {
    out.push({
      kind: 'RISK',
      mark: '⚠️',
      title: `核实 ${o.customer.name} 的物流`,
      reason: `订单 ${o.orderNo} 运输中，预计到货已逾期`,
      amount: o.amountRMB.toFixed(2),
      customerId: o.customerId,
      customerName: o.customer.name,
      country: o.customer.country,
      orderId: o.id,
    });
  }

  return out.slice(0, 4).map((item, index) => ({ ...item, id: `${item.kind}:${item.customerId ?? index}`, rank: index + 1 }));
}

/** 抽屉：客户信息 + 历史沟通 + AI 建议下一步 + 订单金额。 */
export async function taskInsight(user: Actor, taskId: string) {
  const task = await db.task.findFirst({ where: { AND: [taskScope(user), { id: taskId }] }, include });
  if (!task) throw new HttpError(404, '任务不存在或无权查看');

  const customer = task.customerId
    ? await db.customer.findFirst({
        where: { id: task.customerId },
        select: {
          id: true, name: true, companyName: true, country: true, stage: true, whatsapp: true, email: true, phone: true, language: true,
          productInterest: true, estimatedOrderValue: true, currency: true, aiScore: true, aiIntent: true, aiNextAction: true, nextFollowUpAt: true,
          followUps: { orderBy: { followUpAt: 'desc' }, take: 5, select: { id: true, type: true, content: true, followUpAt: true } },
          whatsappMessages: { orderBy: { sentAt: 'desc' }, take: 5, where: user.role==='ADMIN'?{}:{id:{in:[]}}, select: { id: true, direction: true, content: true, sentAt: true } },
          quotations: { orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, quoteNumber: true, product: true, quantity: true, unitPrice: true, currency: true, status: true, sentAt: true } },
        },
      })
    : null;

  const timeline = [
    ...(customer?.followUps ?? []).map(f => ({ kind: 'FOLLOW_UP' as const, at: f.followUpAt.toISOString(), text: f.content || '(无摘要)', channel: f.type })),
    ...(customer?.whatsappMessages ?? []).map(m => ({ kind: 'WHATSAPP' as const, at: m.sentAt.toISOString(), text: m.content, channel: m.direction === 'INBOUND' ? '客户发来' : '我们发出' })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  // AI 建议下一步：基于客户当前阶段与最近往来，给出**可执行**的一句话
  const suggested = suggestNext(task.title, customer?.language, customer?.aiNextAction, task.aiReason);

  return {
    task: present(task),
    customer,
    orders: task.customerId
      ? await db.order.findMany({ where: { customerId: task.customerId }, select: { id: true, orderNo: true, amountRMB: true, status: true, paymentStatus: true, orderDate: true }, orderBy: { orderDate: 'desc' }, take: 5 })
      : [],
    timeline,
    suggested,
  };
}

function suggestNext(title: string, language: string | null | undefined, aiNextAction: string | null | undefined, aiReason: string | null | undefined) {
  if (aiNextAction) return aiNextAction;
  if (aiReason) return aiReason;
  const english = language && language.toLowerCase().startsWith('en');
  if (title.includes('报价')) {
    return english
      ? 'Hi, just checking if you have reviewed our quotation. Happy to adjust the specification or quantity if that helps.'
      : '建议今天确认客户是否已看过报价，并主动询问需要调整的规格或数量。';
  }
  if (title.includes('尾款')) {
    return english
      ? 'Production is complete and the goods are ready. Please arrange the balance payment so we can book the shipment.'
      : '生产已完成，建议今天告知客户并确认尾款安排，以便订舱。';
  }
  if (title.includes('回复')) {
    return english ? 'Thanks for your message — let me get back to you with the details shortly.' : '建议今天先回复客户，避免继续沉默造成流失。';
  }
  return english ? 'Following up on our last conversation to keep things moving.' : '建议今天与客户确认下一步安排。';
}

/** 完成反馈：记录完成时间、执行人与结果，而不是让任务直接消失。 */
export async function completeTask(user: Actor, taskId: string, input: unknown) {
  const v = z.object({ outcome: z.string().trim().max(500).default('') }).parse(input);
  const task = await db.task.findFirst({ where: { AND: [taskScope(user), { id: taskId }] }, select: { id: true, description: true,updatedAt:true } });
  if (!task) throw new HttpError(404, '任务不存在或无权查看');

  const note = v.outcome ? `\n\n完成结果：${v.outcome}` : '';
  const saved = await updateTask(task.id,{status:'DONE',updatedAt:task.updatedAt.toISOString(),...(v.outcome?{description:`${task.description}${note}`}:{})},user);
  return { id: saved.id, title: saved.title, completedAt: saved.completedAt?.toISOString() ?? null, outcome: v.outcome };
}

/**
 * 自动生成任务（幂等，按 automationKey）。
 *
 * 已有 workflow-service 负责 CRM 类任务（回复 / 报价跟进 / 跟进）。
 * 这里补**订单与财务**两类 —— 需求里要求但没有覆盖的部分。
 */
export async function autoGenerate(user: Actor) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY);
  const created: string[] = [];

  const [produced, unpaid, unlinked] = await Promise.all([
    // 订单：已付定金、生产完成/运输中，但还没通知客户 → 建「通知生产完成 / 确认尾款」
    db.order.findMany({
      where: { customer: scope(user), paymentStatus: 'DEPOSIT_PAID', status: { in: ['PRODUCING', 'SHIPPED'] } },
      select: { id: true, orderNo: true, amountRMB: true, customerId: true, customer: { select: { name: true } } },
      take: 20,
    }),
    // 财务：定金已付、尾款超过 7 天未收
    db.order.findMany({
      where: { customer: scope(user), paymentStatus: 'DEPOSIT_PAID', orderDate: { lt: sevenDaysAgo } },
      select: { id: true, orderNo: true, amountRMB: true, customerId: true, customer: { select: { name: true } } },
      take: 20,
    }),
    // 订单：还没有任何跟进任务的订单 → 补一条
    db.order.findMany({
      where: { customer: scope(user), tasks: { none: { deletedAt: null } }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true, orderNo: true, amountRMB: true, customerId: true, customer: { select: { name: true } } },
      take: 10,
    }),
  ]);

  const push = async (
    order: { id: string; orderNo: string; amountRMB: Prisma.Decimal; customerId: string; customer: { name: string } },
    spec: { title: string; description: string; type: string; source: string; reason: string; dueDate: Date },
  ) => {
    const key = `order:${order.id}:${spec.type}`;
    const exists = await db.task.findUnique({ where: { automationKey: key }, select: { id: true } });
    if (exists) return;
    await db.task.create({
      data: {
        customerId: order.customerId,
        orderId: order.id,
        amount: order.amountRMB,
        title: spec.title,
        description: spec.description,
        type: spec.type,
        source: spec.source,
        priority: smartPriority({ amount: Number(order.amountRMB), orderRisk: spec.type === 'SHIPPING' }),
        dueDate: spec.dueDate,
        aiReason: spec.reason,
        createdBy: user.id,
        automationKey: key,
      },
    });
    created.push(spec.title);
  };

  for (const order of produced) {
    await push(order, {
      title: `通知 ${order.customer.name} 生产进度`,
      description: `订单 ${order.orderNo} 已进入生产/发货阶段，需告知客户当前进度。`,
      type: 'PRODUCTION',
      source: 'ORDER',
      reason: `订单 ${order.orderNo} 状态为已付定金且已投产`,
      dueDate: new Date(now.getTime() + DAY),
    });
  }
  for (const order of unpaid) {
    await push(order, {
      title: `催收 ${order.customer.name} 的尾款`,
      description: `订单 ${order.orderNo} 定金已付超过 7 天，尾款仍未收。`,
      type: 'PAYMENT',
      source: 'FINANCE',
      reason: `订单 ${order.orderNo} 尾款超过 7 天未收`,
      dueDate: now,
    });
  }
  for (const order of unlinked) {
    await push(order, {
      title: `跟进订单 ${order.orderNo}`,
      description: `该订单还没有跟进记录，请确认客户当前状态。`,
      type: 'FOLLOW_UP',
      source: 'ORDER',
      reason: '订单存在但没有跟进任务',
      dueDate: new Date(now.getTime() + 2 * DAY),
    });
  }

  return { created: created.length, titles: created };
}

export { smartPriority, priorityReason };
