import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin } from '@/lib/auth';
import { radarConfigSchema, readRadarConfig } from '@/lib/radar';
import { deepSeekConfigured } from './deepseek-customer-service';
import { verifierConfigured } from './radar-scoring-service';

/** 设置 · 客户雷达: tunable rules and the keyword × city table the crawler works through. Administrators only. */

const lines = (max: number, label: string) => z.union([z.string(), z.array(z.string())])
  .transform(v => [...new Set((Array.isArray(v) ? v : v.split(/[\n,，;；]+/)).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean))])
  .pipe(z.array(z.string().max(120, `${label}最多 120 个字`)).min(1, `请至少填写一个${label}`).max(max, `一次最多 ${max} 个${label}`));
const searchesInput = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, '请选择国家'),
  cities: lines(100, '城市'),
  keywords: lines(30, '关键词'),
});
const searchPatch = z.object({ active: z.boolean() });

export async function radarSettings(user: Actor) {
  requireAdmin(user, '只有管理员可以修改客户雷达设置');
  const [setting, searches, lastCrawl] = await Promise.all([
    db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } }),
    db.radarSearch.findMany({ orderBy: [{ country: 'asc' }, { city: 'asc' }, { keyword: 'asc' }], include: { _count: { select: { prospects: true } } } }),
    db.syncJob.findFirst({ where: { provider: 'RADAR', jobType: 'CRAWL' }, orderBy: { startedAt: 'desc' } }),
  ]);
  return {
    config: readRadarConfig(setting.radarConfig),
    searches: searches.map(({ _count, ...s }) => ({ ...s, prospects: _count.prospects })),
    lastCrawl: lastCrawl && { status: lastCrawl.status, startedAt: lastCrawl.startedAt, completedAt: lastCrawl.completedAt, found: lastCrawl.processed, created: lastCrawl.succeeded, error: lastCrawl.error },
    health: {
      deepSeek: deepSeekConfigured(),
      verifier: verifierConfigured(),
      verifierName: process.env.EMAIL_VERIFY_PROVIDER?.trim() || 'millionverifier',
      ingest: !!process.env.RADAR_INGEST_SECRET?.trim(),
      cron: !!process.env.META_SYNC_SECRET?.trim(),
    },
  };
}

export async function saveRadarConfig(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以修改客户雷达设置');
  const config = radarConfigSchema.parse(input);
  if (!Object.keys(config.countries).length) throw new HttpError(400, '至少保留一个国家');
  await db.setting.update({ where: { id: 'system' }, data: { radarConfig: config } });
  return { config };
}

/** Adds every city × keyword pair; pairs already in the table are skipped. */
export async function createSearches(input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以修改客户雷达设置');
  const v = searchesInput.parse(input);
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } });
  if (!readRadarConfig(setting.radarConfig).countries[v.country]) throw new HttpError(400, `雷达设置里没有国家 ${v.country}，请先在「国家与发送时段」里添加`);
  const data = v.cities.flatMap(city => v.keywords.map(keyword => ({ country: v.country, city, keyword })));
  const created = await db.radarSearch.createMany({ data, skipDuplicates: true });
  return { created: created.count, skipped: data.length - created.count };
}

export async function updateSearch(id: string, input: unknown, user: Actor) {
  requireAdmin(user, '只有管理员可以修改客户雷达设置');
  z.string().trim().min(1).max(191).parse(id);
  const v = searchPatch.parse(input);
  const changed = await db.radarSearch.updateMany({ where: { id }, data: v });
  if (!changed.count) throw new HttpError(404, '关键词 × 城市不存在');
  return { id };
}

/** Prospects found by a deleted row stay; they only lose the link to it. */
export async function deleteSearch(id: string, user: Actor) {
  requireAdmin(user, '只有管理员可以修改客户雷达设置');
  z.string().trim().min(1).max(191).parse(id);
  try { await db.radarSearch.delete({ where: { id } }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new HttpError(404, '关键词 × 城市不存在');
    throw error;
  }
  return { id };
}
