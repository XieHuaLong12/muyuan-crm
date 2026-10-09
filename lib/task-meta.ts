/**
 * 任务中心的展示元数据。
 * 放 lib 而不是 service：界面组件要用，service 引了 Prisma 与鉴权。
 */

export const TASK_SOURCES = {
  CRM: { label: 'CRM', tone: 'crm' },
  WORKFLOW: { label: '自动跟进', tone: 'crm' },
  ORDER: { label: '订单', tone: 'order' },
  FINANCE: { label: '财务', tone: 'finance' },
  ADS: { label: '广告', tone: 'ads' },
  AI: { label: 'AI', tone: 'ai' },
  MANUAL: { label: '手动', tone: 'manual' },
} as const;

export type TaskSource = keyof typeof TASK_SOURCES;

export const TASK_PRIORITIES = {
  HIGH: { label: '高优先级', mark: '🔥', tone: 'high' },
  MEDIUM: { label: '普通任务', mark: '⚡', tone: 'medium' },
  LOW: { label: '低优先级', mark: '○', tone: 'low' },
} as const;

export const TASK_STATUS = { TODO: '待处理', DOING: '进行中', DONE: '已完成' } as const;

/** 智能优先级：不是手填，而是按业务条件判定。 */
export function smartPriority(input: { amount?: number | null; quoted?: boolean; daysSinceReply?: number | null; orderRisk?: boolean; source?: string }) {
  if (input.orderRisk) return 'HIGH';
  if (input.quoted && (input.daysSinceReply ?? 0) >= 3) return 'HIGH';
  if ((input.amount ?? 0) >= 50000) return 'HIGH';
  if ((input.daysSinceReply ?? 0) >= 3) return 'MEDIUM';
  if ((input.amount ?? 0) > 0) return 'MEDIUM';
  return 'LOW';
}

/** 判定理由，让老板知道任务为什么出现。 */
export function priorityReason(input: { amount?: number | null; quoted?: boolean; daysSinceReply?: number | null; orderRisk?: boolean }) {
  if (input.orderRisk) return '订单存在风险，需要立即处理';
  if (input.quoted && (input.daysSinceReply ?? 0) >= 3) return `报价后 ${input.daysSinceReply} 天未回复`;
  if ((input.amount ?? 0) >= 50000) return '高金额订单';
  if ((input.daysSinceReply ?? 0) >= 3) return `超过 ${input.daysSinceReply} 天未回复`;
  return '';
}
