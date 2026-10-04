import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { graphGet, pagedGraphGet } from '@/lib/meta-graph';

/**
 * Meta Marketing API 广告数据同步
 *
 * 数据线（与 Lead Ads webhook 那条线独立）：
 *   System User Token（ads_read）
 *     → GET /act_{id}/campaigns     广告系列目录
 *     → GET /act_{id}/insights      近 30 天按天粒度的花费/展示/点击/线索
 *     → 写入 CRM 现有表 LeadSource / Campaign / MarketingMetric
 *
 * 写入现有三张表后，Growth Center 的「广告表现」与「渠道分析」无需改前端
 * 即展示真实数据（campaign 的 externalId 存 Meta campaign_id 作为幂等键）。
 *
 * token 生命周期：System User Token 长期有效，但仍建议在 Settings 页
 * 手动触发同步时留意失败信息；任何 Graph API 错误都会落到 MetaSyncRun.error。
 */

/** act_123456 或裸数字都可，统一成裸数字（路径拼 /act_{id}）。 */
export function normalizeAccountId(raw: string) {
  return raw.trim().replace(/^act_/i, '');
}

// ── 结构与纯函数（供测试直接调用） ────────────────────────────

const insightSchema = z.object({
  campaign_id: z.string(),
  campaign_name: z.string().default(''),
  date_start: z.string(),
  date_stop: z.string(),
  spend: z.string().default('0'),
  impressions: z.string().default('0'),
  clicks: z.string().default('0'),
  ctr: z.string().default('0'),
  account_currency: z.string().optional(),
  actions: z.array(z.object({ action_type: z.string(), value: z.string().default('0') })).optional(),
});

export type InsightRow = z.infer<typeof insightSchema>;

/**
 * 从 insights 的 actions 里取线索数。
 * 优先 lead（Lead Ads 表单线索），回退 onsite_conversion.lead_grouped（网站事件归组）。
 */
export function leadCountFromActions(actions: InsightRow['actions']): number {
  if (!actions?.length) return 0;
  const lead = actions.find(a => a.action_type === 'lead');
  const grouped = actions.find(a => a.action_type === 'onsite_conversion.lead_grouped');
  const picked = lead ?? grouped;
  if (!picked) return 0;
  const value = Number(picked.value);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export type MetricRow = {
  campaignId: string;
  campaignName: string;
  metricDate: Date;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  currency: string;
};

/** insights 行 → MarketingMetric 行。metricDate 取 Meta 的 date_start（账户时区的自然日）。 */
export function metricRowsFromInsights(rows: unknown[]): MetricRow[] {
  const out: MetricRow[] = [];
  for (const raw of rows) {
    const parsed = insightSchema.safeParse(raw);
    if (!parsed.success) continue;
    const row = parsed.data;
    const date = new Date(`${row.date_start}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) continue;
    const spend = Number(row.spend);
    out.push({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      metricDate: date,
      spend: Number.isFinite(spend) ? spend : 0,
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      leads: leadCountFromActions(row.actions),
      currency: row.account_currency || 'USD',
    });
  }
  return out;
}

const campaignSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  status: z.string().default(''),
  effective_status: z.string().optional(),
  objective: z.string().optional(),
});

// ── 同步执行记录 ──────────────────────────────────────────────

/** 把一次同步包进 MetaSyncRun：RUNNING → OK/FAILED，失败原因落库便于排查。 */
export async function withSyncRun<T extends object>(kind: 'ADS' | 'FORMS' | 'ALL', fn: () => Promise<T>): Promise<T & { runId: string }> {
  const run = await db.metaSyncRun.create({ data: { kind, status: 'RUNNING', error: '' } });
  try {
    const result = await fn();
    await db.metaSyncRun.update({ where: { id: run.id }, data: { status: 'OK', detail: result as Prisma.InputJsonValue, finishedAt: new Date() } });
    return { ...result, runId: run.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.metaSyncRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: message.slice(0, 2000), finishedAt: new Date() } }).catch(() => undefined);
    return { ok: false, error: message, runId: run.id } as unknown as T & { runId: string };
  }
}

// ── 同步主体 ──────────────────────────────────────────────────

export function adsEnv() {
  const token = process.env.META_ADS_ACCESS_TOKEN?.trim();
  const accountId = normalizeAccountId(process.env.META_AD_ACCOUNT_ID?.trim() || '');
  const missing: string[] = [];
  if (!token) missing.push('META_ADS_ACCESS_TOKEN');
  if (!accountId) missing.push('META_AD_ACCOUNT_ID');
  return { token: token ?? '', accountId, missing };
}

async function adminId(): Promise<string> {
  const owner = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  return owner.id;
}

/** 同步广告账户 + 广告系列目录 + 近 30 天按天 insights。幂等：重复执行只更新。 */
export async function syncAds() {
  return withSyncRun('ADS', async () => {
    const { token, accountId, missing } = adsEnv();
    if (!token || !accountId) {
      throw new Error(`Meta 广告同步未配置：缺少 ${missing.join('、')}`);
    }

    // 1. 广告账户
    const accountResult = await graphGet<{ id: string; name: string; currency: string; timezone_name: string; account_status: number; disable_reason: number }>(
      `act_${accountId}`,
      token,
      { fields: 'id,name,currency,timezone_name,account_status,disable_reason' },
    );
    if (!accountResult.ok) throw new Error(accountResult.error);
    const account = accountResult.data;
    const admin = await adminId();
    await db.metaAdAccount.upsert({
      where: { externalId: account.id },
      create: { externalId: account.id, name: account.name, currency: account.currency || 'USD', timezone: account.timezone_name || '', status: account.account_status || 0, disableReason: account.disable_reason || 0, syncedAt: new Date() },
      update: { name: account.name, currency: account.currency || 'USD', timezone: account.timezone_name || '', status: account.account_status || 0, disableReason: account.disable_reason || 0, syncedAt: new Date() },
    });

    // 2. 广告系列目录
    const campaignResult = await pagedGraphGet<unknown>(`act_${accountId}/campaigns`, token, { fields: 'id,name,status,effective_status,objective', limit: '500' });
    if (campaignResult.error) throw new Error(campaignResult.error);
    const campaigns = campaignResult.rows.flatMap(raw => {
      const parsed = campaignSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    });

    // 3. 线索来源（channel=FACEBOOK 的幂等入口，供 Campaign.sourceId 关联）
    const source = await db.leadSource.findFirst({ where: { channel: 'FACEBOOK', createdBy: admin } })
      ?? await db.leadSource.create({ data: { name: 'Meta Ads', channel: 'FACEBOOK', externalId: account.id, createdBy: admin } });

    // 4. 广告系列 upsert（幂等键：channel + externalId）
    const campaignIds = new Map<string, string>(); // meta campaign_id → CRM id
    let created = 0;
    let updated = 0;
    for (const c of campaigns) {
      const existing = await db.campaign.findFirst({ where: { channel: 'FACEBOOK', externalId: c.id }, select: { id: true } });
      const status = c.effective_status || c.status || 'ACTIVE';
      if (existing) {
        await db.campaign.update({ where: { id: existing.id }, data: { name: c.name, status, currency: account.currency || 'USD' } });
        campaignIds.set(c.id, existing.id);
        updated++;
      } else {
        const row = await db.campaign.create({ data: { name: c.name, channel: 'FACEBOOK', externalId: c.id, sourceId: source.id, status, currency: account.currency || 'USD', createdBy: admin } });
        campaignIds.set(c.id, row.id);
        created++;
      }
    }

    // 5. 近 30 天 insights（按天），写入 MarketingMetric（幂等键：campaignId + metricDate）
    const insightsResult = await pagedGraphGet<unknown>(`act_${accountId}/insights`, token, {
      fields: 'campaign_id,campaign_name,date_start,date_stop,spend,impressions,clicks,ctr,account_currency,actions',
      date_preset: 'last_30d',
      level: 'campaign',
      time_increment: '1',
      limit: '500',
    });
    if (insightsResult.error) throw new Error(insightsResult.error);

    const metrics = metricRowsFromInsights(insightsResult.rows);
    let metricsUpserted = 0;
    for (const m of metrics) {
      // insights 里可能出现目录请求之后才新建的系列：懒创建，避免丢指标
      let campaignRowId = campaignIds.get(m.campaignId);
      if (!campaignRowId) {
        const existing = await db.campaign.findFirst({ where: { channel: 'FACEBOOK', externalId: m.campaignId }, select: { id: true } });
        if (existing) {
          campaignRowId = existing.id;
        } else {
          const row = await db.campaign.create({ data: { name: m.campaignName || m.campaignId, channel: 'FACEBOOK', externalId: m.campaignId, sourceId: source.id, status: 'ACTIVE', currency: m.currency, createdBy: admin } });
          campaignRowId = row.id;
          created++;
        }
        campaignIds.set(m.campaignId, campaignRowId);
      }
      await db.marketingMetric.upsert({
        where: { campaignId_metricDate: { campaignId: campaignRowId, metricDate: m.metricDate } },
        create: { campaignId: campaignRowId, metricDate: m.metricDate, spend: new Prisma.Decimal(m.spend.toFixed(2)), impressions: m.impressions, clicks: m.clicks, leads: m.leads },
        update: { spend: new Prisma.Decimal(m.spend.toFixed(2)), impressions: m.impressions, clicks: m.clicks, leads: m.leads },
      });
      metricsUpserted++;
    }

    const adFacts=await (await import('./meta-ad-facts-service')).syncAdFacts(token,accountId);
    const dates = metrics.map(m => m.metricDate.getTime()).sort((a, b) => a - b);
    return {
      ok: true,
      account: { id: account.id, name: account.name, currency: account.currency, timezone: account.timezone_name, status: account.account_status },
      adFacts,
      campaigns: { created, updated, total: campaigns.length },
      metrics: { upserted: metricsUpserted },
      window: dates.length ? { from: new Date(dates[0]).toISOString().slice(0, 10), to: new Date(dates[dates.length - 1]).toISOString().slice(0, 10) } : null,
    };
  });
}

/** 供状态页读取：最近的同步记录与账户摘要。 */
export async function metaAdsStatus() {
  const [account, lastRun, campaignCount, metricCount] = await Promise.all([
    db.metaAdAccount.findFirst({ orderBy: { syncedAt: 'desc' } }),
    db.metaSyncRun.findFirst({ where: { kind: 'ADS' }, orderBy: { startedAt: 'desc' } }),
    db.campaign.count({ where: { channel: 'FACEBOOK' } }),
    db.marketingMetric.count({ where: { campaign: { channel: 'FACEBOOK' } } }),
  ]);
  const { missing } = adsEnv();
  return {
    configured: missing.length === 0,
    missing,
    account: account ? { externalId: account.externalId, name: account.name, currency: account.currency, timezone: account.timezone, status: account.status, syncedAt: account.syncedAt?.toISOString() ?? null } : null,
    campaigns: campaignCount,
    metrics: metricCount,
    lastRun: lastRun ? { status: lastRun.status, error: lastRun.error, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null } : null,
  };
}
