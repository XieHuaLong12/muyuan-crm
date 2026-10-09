import { stages } from './constants';

// 看板列与客户阶段一一对应，名称统一取自 lib/constants 的阶段名，避免同一阶段多种叫法。
const order = ['NEW','CONTACTED','REPLIED','CATALOG_SENT','NEEDS_CONFIRMED','PRODUCT_CONFIRMED','QUOTED','FOLLOW_UP','ORDER','WON','PAUSED','LOST','INVALID'] as const;
export const KANBAN_STAGES = order.map(key => ({ key, label: stages[key] }));
export type KanbanStage = typeof order[number];
/** 进入这些阶段需要填写原因，便于管理员复核销售对线索的判断。 */
export const KANBAN_REASON_STAGES: readonly KanbanStage[] = ['PAUSED', 'LOST', 'INVALID'];
export const KANBAN_COLUMN_LIMIT = 50;
