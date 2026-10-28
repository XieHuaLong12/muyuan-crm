import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/auth';
import { canonicalPhone } from '@/lib/contact-identity';
import { SOCIAL_KEYS, cleanEmail, emailKind, mailability, nameCityKey, normalizeDomain, readRadarConfig, timezoneFor } from '@/lib/radar';
import { findBosCustomer } from './radar-bos-service';
import { sendPush } from './push-service';

/**
 * What the crawler (extensions/radar-crawler) talks to: today's keyword × city plan, batches of map results with
 * what was read on each site, and the run report. The crawler holds only RADAR_INGEST_SECRET — no database, no AI —
 * so every decision (deduplication, skipping existing customers, scoring) is made here.
 */

const text = (max: number) => z.string().trim().default('').transform(v => v.slice(0, max));
const number = (max: number, decimals: number) => z.union([z.number(), z.string(), z.null()]).default(null)
  .transform(v => v === null || v === '' ? null : Number(String(v).replace(',', '.')))
  .transform(v => v !== null && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v * 10 ** decimals) / 10 ** decimals, max) : null);

// Machine input is truncated rather than refused: one long address must not bounce a whole batch back to the crawler.
const placeInput = z.object({
  placeKey: z.string().trim().min(1, '缺少 placeKey').transform(v => v.slice(0, 191)),
  name: z.string().trim().min(1, '缺少店名').transform(v => v.slice(0, 300)),
  city: text(120),
  address: text(500),
  website: text(500),
  phone: text(40),
  category: text(200),
  rating: number(5, 1),
  reviewCount: number(10_000_000, 0),
  emails: z.array(z.object({ address: z.string().max(400), foundOn: text(500) })).max(40).default([]),
  whatsapp: text(40),
  socials: z.record(z.string(), z.string().max(500)).default({}),
  siteText: z.string().default('').transform(v => v.replace(/\s+/g, ' ').trim().slice(0, 4000)),
});
const ingestInput = z.object({
  searchId: z.string().trim().min(1).max(191).nullable().default(null),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().default(null),
  places: z.array(placeInput).min(1, '没有商家').max(50, '每批最多 50 家'),
});
const reportInput = z.object({
  status: z.enum(['DONE', 'CAPTCHA', 'ERROR']),
  startedAt: z.string().datetime({ offset: true }),
  searches: z.array(z.object({ id: z.string().trim().min(1).max(191), found: z.number().int().min(0).max(100_000) })).max(500).default([]),
  error: z.string().trim().max(1000).default(''),
});

/** Today's rows: the active keyword × city rows that ran longest ago (never-run first), as many as the setting allows. */
export async function crawlPlan() {
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } });
  const config = readRadarConfig(setting.radarConfig);
  const rows = await db.radarSearch.findMany({ where: { active: true, country: { in: Object.keys(config.countries) } },
    orderBy: [{ lastRunAt: 'asc' }, { createdAt: 'asc' }], take: config.searchesPerDay });
  return { searches: rows.map(s => ({ id: s.id, country: s.country, city: s.city, keyword: s.keyword, language: config.countries[s.country].language, query: `${s.keyword} ${s.city}` })) };
}

const socialsOf = (input: Record<string, string>) => {
  const kept = Object.fromEntries(Object.entries(input).map(([k, v]) => [k.toLowerCase(), v.trim()]).filter(([k, v]) => (SOCIAL_KEYS as readonly string[]).includes(k) && /^https?:\/\//i.test(v)));
  return Object.keys(kept).length ? kept : undefined;
};
const waNumber = (value: string) => canonicalPhone(value.replace(/^https?:\/\/(api\.)?wa\.me\//i, '').replace(/^https?:\/\/api\.whatsapp\.com\/send\?phone=/i, '').split(/[?/&]/)[0], undefined, true);

type Place = z.infer<typeof placeInput>;
function emailRows(place: Place) {
  const seen = new Map<string, { address: string; kind: string; foundOn: string }>();
  for (const e of place.emails) {
    const address = cleanEmail(e.address);
    if (address && !seen.has(address)) seen.set(address, { address, kind: emailKind(address), foundOn: e.foundOn });
  }
  return [...seen.values()].slice(0, 20);
}

/** Adds addresses found again to an existing prospect, and fills fields that were empty. Never overwrites a value. */
async function mergeInto(id: string, place: Place, emails: ReturnType<typeof emailRows>, domain: string) {
  const p = await db.radarProspect.findUniqueOrThrow({ where: { id }, select: { website: true, domain: true, phone: true, siteText: true, whatsapp: true, address: true } });
  const fill: Prisma.RadarProspectUpdateInput = {};
  if (!p.website && place.website) { fill.website = place.website; fill.domain = domain; }
  if (!p.phone && place.phone) fill.phone = place.phone;
  if (!p.whatsapp && place.whatsapp) fill.whatsapp = place.whatsapp;
  if (!p.address && place.address) fill.address = place.address;
  if (!p.siteText && place.siteText) fill.siteText = place.siteText;
  if (Object.keys(fill).length) await db.radarProspect.update({ where: { id }, data: fill });
  if (!emails.length) return;
  await db.radarEmail.createMany({ data: emails.map(e => ({ ...e, prospectId: id, source: 'WEBSITE' })), skipDuplicates: true });
  // A shop marked 无邮箱 that now shows an address can be mailed after all.
  const now = await db.radarProspect.findUniqueOrThrow({ where: { id }, select: { status: true, emails: true } });
  if (now.status === 'NO_EMAIL' && mailability(now.emails) !== 'NONE') await db.radarProspect.updateMany({ where: { id, status: 'NO_EMAIL' }, data: { status: 'NEW', statusAt: new Date() } });
}

/**
 * Stores a batch of map results. A place already on the radar (same map id, domain, phone, or name + city) only adds
 * what it newly brings; a company that is already a customer is stored as excluded — so it is never mailed and never
 * crawled into the card wall again.
 */
export async function ingestProspects(input: unknown) {
  const v = ingestInput.parse(input);
  const search = v.searchId ? await db.radarSearch.findUnique({ where: { id: v.searchId } }) : null;
  if (v.searchId && !search) throw new HttpError(404, '关键词 × 城市不存在');
  const country = search?.country ?? v.country;
  if (!country) throw new HttpError(400, '缺少国家');
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } });
  const config = readRadarConfig(setting.radarConfig);
  if (!config.countries[country]) throw new HttpError(400, `雷达设置里没有国家 ${country}`);

  const result = { created: 0, duplicates: 0, inBos: 0 };
  for (const place of v.places) {
    const domain = normalizeDomain(place.website);
    const phoneE164 = canonicalPhone(place.phone, country) ?? canonicalPhone(place.phone, undefined, true);
    const whatsappE164 = place.whatsapp ? waNumber(place.whatsapp) : null;
    const key = nameCityKey(place.name, place.city);
    const emails = emailRows(place);
    const existing = await db.radarProspect.findFirst({ where: { OR: [
      { placeKey: place.placeKey }, ...(domain ? [{ domain }] : []), ...(phoneE164 ? [{ phoneE164 }] : []),
      // A name made only of legal forms ("SARL") is no name: it would collapse every such shop in the city into one.
      ...(key.startsWith('|') ? [] : [{ nameCityKey: key }]),
    ] }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    if (existing) { await mergeInto(existing.id, place, emails, domain); result.duplicates++; continue; }

    const customer = await findBosCustomer({ emails: emails.map(e => e.address), phones: [phoneE164, whatsappE164].filter((p): p is string => !!p), domain });
    try {
      await db.radarProspect.create({ data: {
        placeKey: place.placeKey, name: place.name, nameCityKey: key, country, city: place.city, timezone: timezoneFor(country, place.city, config),
        address: place.address, website: place.website, domain, phone: place.phone, phoneE164, whatsapp: whatsappE164 ?? '',
        socials: socialsOf(place.socials), mapsCategory: place.category, rating: place.rating, reviewCount: place.reviewCount,
        siteText: place.siteText || null, keyword: search?.keyword ?? '', searchId: search?.id ?? null,
        status: customer ? 'EXCLUDED' : emails.length ? 'NEW' : 'NO_EMAIL', excludedReason: customer ? `已在 BOS：${customer.companyName || customer.name}`.slice(0, 200) : '',
        emails: { create: emails.map(e => ({ ...e, source: 'WEBSITE' })) },
      } });
      if (customer) result.inBos++; else result.created++;
    } catch (error) {
      // Two batches carrying the same place at once: the other one stored it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') { result.duplicates++; continue; }
      throw error;
    }
  }
  return result;
}

/**
 * The crawler's run report: each keyword × city row records when it ran and what it found, and a run that hit a
 * captcha or failed rings the administrators — the crawler stops for the day on its own.
 */
export async function reportCrawl(input: unknown) {
  const v = reportInput.parse(input);
  const startedAt = new Date(v.startedAt);
  const now = new Date();
  let created = 0;
  for (const s of v.searches) {
    const fresh = await db.radarProspect.count({ where: { searchId: s.id, discoveredAt: { gte: startedAt } } });
    created += fresh;
    await db.radarSearch.updateMany({ where: { id: s.id }, data: { lastRunAt: now, lastFound: s.found, lastNew: fresh } });
  }
  const job = await db.syncJob.create({ data: {
    provider: 'RADAR', jobType: 'CRAWL', status: v.status, startedAt, completedAt: now,
    processed: v.searches.reduce((sum, s) => sum + s.found, 0), succeeded: created, failed: v.status === 'DONE' ? 0 : 1,
    error: v.error || null, detail: { searches: v.searches },
  }, select: { id: true } });
  if (v.status !== 'DONE') {
    const admins = await db.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    await sendPush(admins.map(a => a.id), {
      title: v.status === 'CAPTCHA' ? '客户雷达：地图出现验证码，今天的爬取已停止' : '客户雷达：今天的地图爬取失败',
      body: (v.error || `已完成 ${v.searches.length} 组关键词，新入库 ${created} 家`).slice(0, 180),
      href: '/settings/radar', tag: `radar-crawl-${job.id}`, urgent: false,
    }, 12 * 3600).catch(() => null);
  }
  return { jobId: job.id, created };
}
