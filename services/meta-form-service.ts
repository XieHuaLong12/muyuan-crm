import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { pagedGraphGet } from '@/lib/meta-graph';
import { withSyncRun } from './meta-ads-service';

/**
 * Meta Lead Ads 表单目录同步
 *
 * 用现有 Page Access Token（leads_retrieval）拉取：
 *   GET /{page_id}/leadgen_forms?fields=id,name,status,questions,leads_count
 *
 * 缓存进 MetaLeadForm。之后 MetaLeadEvent.formId 关联表单名，
 * 状态页可看到「每个表单带来了多少条线索 / 对应多少 CRM 客户」。
 */

const formSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  status: z.string().default(''),
  questions: z.array(z.record(z.unknown())).optional(),
  leads_count: z.number().optional(),
});

export type FormRow = { formId: string; name: string; status: string; questions: unknown[] | null; leadsCount: number };

/** leadgen_forms 原始行 → 结构化表单行（供测试与同步共用）。 */
export function formRowsFromPayload(rows: unknown[]): FormRow[] {
  const out: FormRow[] = [];
  for (const raw of rows) {
    const parsed = formSchema.safeParse(raw);
    if (!parsed.success) continue;
    const form = parsed.data;
    out.push({
      formId: form.id,
      name: form.name,
      status: form.status,
      questions: form.questions ?? null,
      leadsCount: form.leads_count ?? 0,
    });
  }
  return out;
}

export function formsEnv() {
  const token = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  const pageId = process.env.META_PAGE_ID?.trim();
  const missing: string[] = [];
  if (!token) missing.push('META_PAGE_ACCESS_TOKEN');
  if (!pageId) missing.push('META_PAGE_ID');
  return { token: token ?? '', pageId: pageId ?? '', missing };
}

/** 同步表单目录（幂等：按 formId upsert）。 */
export async function syncLeadForms() {
  return withSyncRun('FORMS', async () => {
    const { token, pageId, missing } = formsEnv();
    if (!token || !pageId) {
      throw new Error(`Meta 表单同步未配置：缺少 ${missing.join('、')}`);
    }

    const result = await pagedGraphGet<unknown>(`${pageId}/leadgen_forms`, token, {
      fields: 'id,name,status,questions,leads_count,created_time',
      limit: '500',
    });
    if (result.error) throw new Error(result.error);

    const forms = formRowsFromPayload(result.rows);
    const toJson = (value: unknown[] | null) => value as unknown as Prisma.InputJsonValue;
    let created = 0;
    let updated = 0;
    for (const form of forms) {
      const existing = await db.metaLeadForm.findUnique({ where: { formId: form.formId }, select: { id: true } });
      if (existing) {
        await db.metaLeadForm.update({
          where: { id: existing.id },
          data: { pageId, name: form.name, status: form.status, questions: toJson(form.questions), leadsCount: form.leadsCount, syncedAt: new Date() },
        });
        updated++;
      } else {
        await db.metaLeadForm.create({
          data: { formId: form.formId, pageId, name: form.name, status: form.status, questions: toJson(form.questions), leadsCount: form.leadsCount, syncedAt: new Date() },
        });
        created++;
      }
    }

    return { ok: true, pageId, forms: { created, updated, total: forms.length } };
  });
}

/** 供状态页读取：表单目录 + 每表单线索/客户数 + 最近同步记录。 */
export async function metaFormsStatus() {
  const [forms, lastRun] = await Promise.all([
    db.metaLeadForm.findMany({ orderBy: { leadsCount: 'desc' }, take: 50 }),
    db.metaSyncRun.findFirst({ where: { kind: 'FORMS' }, orderBy: { startedAt: 'desc' } }),
  ]);
  const eventCounts = await db.metaLeadEvent.groupBy({ by: ['formId'], _count: { _all: true } });
  const byForm = new Map(eventCounts.map(e => [e.formId, e._count._all]));
  const { missing } = formsEnv();
  return {
    configured: missing.length === 0,
    missing,
    total: forms.length,
    forms: forms.map(form => ({
      formId: form.formId,
      name: form.name,
      status: form.status,
      leadsCount: form.leadsCount,
      events: byForm.get(form.formId) ?? 0,
      syncedAt: form.syncedAt?.toISOString() ?? null,
    })),
    lastRun: lastRun ? { status: lastRun.status, error: lastRun.error, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null } : null,
  };
}
