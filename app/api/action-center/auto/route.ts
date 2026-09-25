import { requireUser } from '@/lib/auth';
import { handle,ok } from '@/lib/http';
import { autoGenerate } from '@/services/action-center-service';
export const dynamic='force-dynamic';
/** AI 今日分析：按客户 / 订单 / 财务数据自动生成今天该做的任务（幂等）。 */
export async function POST(){return handle(async()=>ok(await autoGenerate(await requireUser())));}
