/**
 * 订单状态与七段流程定义。
 *
 * 放在 lib 而不是 service，因为界面组件也要用：service 引了 Prisma 与鉴权，
 * 客户端组件直接 import 会把服务端代码打进浏览器包。
 */

export const ORDER_STATUS = {
  PENDING_PAYMENT: '待付款',
  PRODUCING: '生产中',
  SHIPPED: '已发货',
  IN_TRANSIT: '运输中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS;

/** 可从订单列表直接切换的主状态；付款、清关等细项仍由各自字段记录。 */
export const ORDER_MILESTONES = ['PENDING_PAYMENT', 'PRODUCING', 'SHIPPED', 'IN_TRANSIT', 'COMPLETED'] as const;
export type OrderMilestone = typeof ORDER_MILESTONES[number];

/** 固定七段流程，顺序即进度条顺序。 */
export const ORDER_STAGES = ['下单', '付款', '生产', '发货', '运输', '清关', '收货'] as const;

export const PAYMENT_STATUS = { UNPAID: '未付款', DEPOSIT_PAID: '已付定金', PAID: '已付清' } as const;
export const PRODUCTION_STATUS = { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', DONE: '已完成' } as const;
export const SHIPPING_STATUS = {
  NOT_SHIPPED: '未发货',
  SHIPPED: '已发货',
  IN_TRANSIT: '运输中',
  CUSTOMS: '清关中',
  DELIVERED: '已签收',
} as const;

/** status → 已完成的最后一段下标；CANCELLED 单独处理。 */
export const STATUS_STAGE: Record<string, number> = {
  PENDING_PAYMENT: 0,
  PRODUCING: 2,
  SHIPPED: 3,
  IN_TRANSIT: 4,
  COMPLETED: 6,
};

/** 进度条数据：done[i] 表示第 i 段已完成。 */
export function stageProgress(status: string): { done: boolean[]; cancelled: boolean } {
  const cancelled = status === 'CANCELLED';
  const last = STATUS_STAGE[status] ?? 0;
  return { done: ORDER_STAGES.map((_, index) => index <= last), cancelled };
}
