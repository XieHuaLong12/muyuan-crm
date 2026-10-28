import { z } from 'zod';

/**
 * 客户雷达 · 开发信 (docs/CUSTOMER_RADAR_COLD_EMAIL.md). The rules live here as pure functions — no database, no
 * network — so every threshold, key and label is unit-tested and the services only move data.
 */

export const PROSPECT_STATUSES = {
  NEW: '新发现', NO_EMAIL: '无邮箱', QUEUED: '队列中', IN_SEQUENCE: '序列进行中', IN_BOS: '已进 BOS', REVIEW: '待复核',
  NO_REPLY: '无回复', NOT_INTERESTED: '不感兴趣', UNSUBSCRIBED: '退订', CONTACTED: '已联系', EXCLUDED: '已排除',
} as const;
export type ProspectStatus = keyof typeof PROSPECT_STATUSES;
/** Prospects waiting for someone to act on them: the card wall shows these by default. */
export const OPEN_STATUSES: readonly ProspectStatus[] = ['NEW', 'NO_EMAIL'];

export const CUSTOMER_TYPES = {
  WHOLESALER: '批发商', IMPORTER: '进口商', FURNITURE_STORE: '家具店', MATTRESS_STORE: '床垫店', OTHER: '其他', UNRELATED: '不相关',
} as const;
export type CustomerType = keyof typeof CUSTOMER_TYPES;
export const EMAIL_KINDS = { DIRECT: '直达', GENERIC: '通用' } as const;
export type EmailKind = keyof typeof EMAIL_KINDS;
export const VERIFY_STATUSES = { VALID: '有效', RISKY: '风险', INVALID: '无效', UNKNOWN: '待重试' } as const;
export type VerifyStatus = keyof typeof VERIFY_STATUSES | '';
export const SOCIAL_KEYS = ['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube'] as const;

/** Points per scoring dimension; contactability is computed by rules from the e-mail checks, the AI scores the rest. */
export const SCORE_MAX = { type: 40, category: 20, scale: 15, contactability: 15, intent: 10 } as const;
export type ScoreParts = { [K in keyof typeof SCORE_MAX]: number };
export const SCORE_LABELS: Record<keyof typeof SCORE_MAX, string> = { type: '客户类型', category: '品类匹配', scale: '规模', contactability: '可联系度', intent: '意向信号' };
/** A: 70 and above, B: 50–69, C: below 50. */
export const gradeOf = (score: number) => score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
/** Each e-mail check is paid for: only prospects that may be mailed (A and B) are checked, at most this many addresses each. */
export const VERIFY_PER_PROSPECT = 2;
export const MAX_ATTEMPTS = 3;

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
export const customerTypeEnum = z.enum(keys(CUSTOMER_TYPES));
export const prospectStatusEnum = z.enum(keys(PROSPECT_STATUSES));

// ─── Settings ───────────────────────────────────────────

export const validTimeZone = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式为 HH:MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式为 yyyy-MM-dd');
const zone = z.string().trim().min(1).max(40).refine(validTimeZone, '时区无效，请填 IANA 时区，例如 Europe/Paris');

const countrySchema = z.object({
  name: z.string().trim().min(1, '请填写国家名称').max(20),
  language: z.enum(['fr', 'en']),
  timezone: zone,
  /** 0 = Sunday … 6 = Saturday, in the recipient's calendar. */
  workdays: z.array(z.number().int().min(0).max(6)).min(1, '至少选一个工作日').max(7),
  start: hhmm,
  end: hhmm,
  holidays: z.array(day).max(60).default([]),
  /** Cities in another time zone than the country's default (Perth, Brisbane…), matched without case and accents. */
  cityTimezones: z.record(z.string().trim().min(1).max(120), zone).default({}),
}).refine(c => c.start < c.end, { message: '发送时段的开始时间要早于结束时间', path: ['end'] });

export const radarConfigSchema = z.object({
  countries: z.record(z.string().regex(/^[A-Z]{2}$/, '国家代码为两个大写字母'), countrySchema),
  /** Keyword × city rows the crawler runs per day. */
  searchesPerDay: z.number().int().min(1).max(500),
  /** Daily new-mail cap per mailbox for each week since its warm-up started; the last value holds from then on. */
  rampLevels: z.array(z.number().int().min(0).max(200)).min(1).max(12),
  intervalMin: z.number().int().min(1).max(120),
  intervalMax: z.number().int().min(1).max(240),
  riskyPerMailboxPerDay: z.number().int().min(0).max(100),
  /** Working days to wait before the 2nd and the 3rd mail. */
  followUpWorkdays: z.tuple([z.number().int().min(1).max(30), z.number().int().min(1).max(30)]),
  /** Days after the 3rd mail before the sequence ends without a reply. */
  endDays: z.number().int().min(1).max(60),
  noReplyCooldownDays: z.number().int().min(1).max(730),
  notInterestedCooldownDays: z.number().int().min(1).max(730),
  bounceWindow: z.number().int().min(10).max(1000),
  maxBouncesInWindow: z.number().int().min(0).max(100),
  maxConsecutiveFailures: z.number().int().min(1).max(20),
  reviewConfidence: z.number().min(0).max(1),
  /** Days after the first mail went out during which every first mail and every valid reply waits for a person. */
  strictReviewDays: z.number().int().min(0).max(90),
  minSample: z.number().int().min(10).max(10_000),
  winProbability: z.number().min(0.5).max(1),
  loseProbability: z.number().min(0).max(0.5),
  fairInvitation: z.boolean(),
  retentionMonths: z.number().int().min(1).max(60),
  /** {目录链接}: the catalogue page on the company site, per template language; empty until someone fills it in. */
  catalogUrls: z.object({
    fr: z.union([z.literal(''), z.string().trim().url('目录链接要以 https:// 开头').max(300)]),
    en: z.union([z.literal(''), z.string().trim().url('目录链接要以 https:// 开头').max(300)]),
  }),
}).refine(c => c.intervalMin <= c.intervalMax, { message: '最短间隔不能大于最长间隔', path: ['intervalMax'] });
export type RadarConfig = z.infer<typeof radarConfigSchema>;
export type CountryConfig = z.infer<typeof countrySchema>;

const weekdays = [1, 2, 3, 4, 5];
export const DEFAULT_RADAR_CONFIG: RadarConfig = {
  countries: {
    FR: { name: '法国', language: 'fr', timezone: 'Europe/Paris', workdays: weekdays, start: '09:00', end: '16:30', holidays: [], cityTimezones: {} },
    AE: { name: '阿联酋', language: 'en', timezone: 'Asia/Dubai', workdays: weekdays, start: '09:00', end: '16:30', holidays: [], cityTimezones: {} },
    // Saudi Arabia's weekend is Friday and Saturday.
    SA: { name: '沙特', language: 'en', timezone: 'Asia/Riyadh', workdays: [0, 1, 2, 3, 4], start: '09:00', end: '16:30', holidays: [], cityTimezones: {} },
    AU: { name: '澳大利亚', language: 'en', timezone: 'Australia/Sydney', workdays: weekdays, start: '09:00', end: '16:30', holidays: [], cityTimezones: {
      Perth: 'Australia/Perth', Brisbane: 'Australia/Brisbane', 'Gold Coast': 'Australia/Brisbane', Adelaide: 'Australia/Adelaide', Darwin: 'Australia/Darwin', Hobart: 'Australia/Hobart',
    } },
  },
  searchesPerDay: 20,
  // Weeks 1–2 warm up only; 10, 20, 30, then 40 a day from week 6.
  rampLevels: [0, 0, 10, 20, 30, 40],
  intervalMin: 6,
  intervalMax: 15,
  riskyPerMailboxPerDay: 5,
  followUpWorkdays: [3, 4],
  endDays: 7,
  noReplyCooldownDays: 90,
  notInterestedCooldownDays: 180,
  bounceWindow: 100,
  maxBouncesInWindow: 3,
  maxConsecutiveFailures: 3,
  reviewConfidence: 0.8,
  strictReviewDays: 14,
  minSample: 100,
  winProbability: 0.9,
  loseProbability: 0.1,
  fairInvitation: false,
  retentionMonths: 12,
  catalogUrls: { fr: '', en: '' },
};

/** Stored settings over the defaults; a value that no longer validates falls back to the defaults as a whole. */
export function readRadarConfig(stored: unknown): RadarConfig {
  const saved = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Partial<RadarConfig> : {};
  const parsed = radarConfigSchema.safeParse({ ...DEFAULT_RADAR_CONFIG, ...saved, countries: saved.countries ?? DEFAULT_RADAR_CONFIG.countries });
  return parsed.success ? parsed.data : DEFAULT_RADAR_CONFIG;
}

// ─── Names, domains, addresses ──────────────────────────

/** Lower case, accents and punctuation removed, single spaces: "Meubles Dupont S.A.R.L." → "meubles dupont sarl". */
export const foldText = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const LEGAL_FORMS = new Set(['sarl', 'sas', 'sasu', 'sa', 'eurl', 'snc', 'sci', 'llc', 'ltd', 'limited', 'pty', 'inc', 'co', 'company',
  'fze', 'fzco', 'fzc', 'fz', 'est', 'establishment', 'trading', 'group', 'groupe', 'the']);
/** Company name and city as one key: the same shop listed twice on the map collapses to one prospect. */
export function nameCityKey(name: string, city: string) {
  // Dotted abbreviations fold to single letters ("S.A.R.L." → "s a r l"); join them back before dropping legal forms.
  const words = foldText(name).replace(/\b[a-z](?: [a-z])+\b/g, letters => letters.replace(/ /g, '')).split(' ').filter(word => word && !LEGAL_FORMS.has(word));
  return `${words.join(' ')}|${foldText(city)}`.slice(0, 191);
}

/** Hosts that are not a company's own site: a social page or a directory says nothing about which company it is. */
const PLATFORM_HOSTS = ['facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'youtube.com', 'twitter.com', 'x.com', 'linktr.ee',
  'wa.me', 'whatsapp.com', 'google.com', 'goo.gl', 'g.page', 'pagesjaunes.fr', 'yelp.com', 'tripadvisor.com', 'leboncoin.fr', 'amazon.com', 'amazon.fr'];
const underHost = (host: string, list: readonly string[]) => list.some(base => host === base || host.endsWith(`.${base}`));

/** The company's own domain from a website address, without "www."; empty for social pages, directories and junk. */
export function normalizeDomain(website: string) {
  const raw = website.trim().toLowerCase();
  if (!raw) return '';
  let host: string;
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`).hostname; } catch { return ''; }
  host = host.replace(/^www\d*\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || underHost(host, PLATFORM_HOSTS)) return '';
  return host.slice(0, 191);
}

const FREE_MAIL = ['gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'yandex.com', 'proton.me', 'protonmail.com',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'neuf.fr', 'bbox.fr', 'numericable.fr', 'bigpond.com', 'bigpond.net.au',
  'optusnet.com.au', 'iinet.net.au', 'tpg.com.au', 'emirates.net.ae', 'eim.ae'];
const FREE_MAIL_PREFIX = /^(hotmail|outlook|live|msn|yahoo|ymail|gmx|web|mail)\.[a-z.]+$/;
/** Webmail and internet-provider domains: an address there says nothing about the company's domain. */
export const isFreeMail = (domain: string) => FREE_MAIL.includes(domain) || FREE_MAIL_PREFIX.test(domain);
export const emailDomain = (address: string) => address.slice(address.lastIndexOf('@') + 1);

/** Addresses nobody reads for buying: sending there only costs reputation. */
const NEVER_LOCAL = /^(no-?reply|do-?not-?reply|ne-?pas-?repondre|newsletter|news|unsubscribe|rgpd|gdpr|dpo|privacy|jobs?|careers?|recrutement|rh|hr|webmaster|abuse|postmaster|mailer-daemon|hostmaster|compta|comptabilite|accounting|accounts|facturation|billing|invoices?)$/;
const GENERIC_LOCAL = /^(contact|contacts|info|infos|information|hello|hi|bonjour|accueil|reception|service|services|serviceclient|service-client|customerservice|support|admin|office|bureau|mail|email|enquir(y|ies)|inquir(y|ies)|sales|vente|ventes|commercial|commerce|shop|boutique|magasin|store|showroom|team|equipe|general|marketing|communication|web|online|orders?|commandes?|sav)$/;
const DIRECT_LOCAL = /^(achats?|purchas(e|es|ing)|buyers?|buying|procurement|sourcing|imports?|importation|direction|directeur|director|gerant|gerance|manager|management|owner|ceo|md|gm|pdg|president)$/;

/** A clean, mailable address from what the crawler found ("mailto:Achat@Shop.fr?subject=x" → "achat@shop.fr"), or null. */
export function cleanEmail(raw: string): string | null {
  let value = raw.trim();
  try { value = decodeURIComponent(value); } catch { /* keep as found */ }
  value = value.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase().replace(/^[<("'\s]+|[>)"'.,;:\s]+$/g, '');
  const at = value.lastIndexOf('@');
  if (at < 1 || value.length > 191 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return null;
  const local = value.slice(0, at).split('+')[0], domain = value.slice(at + 1);
  // Retina image names (logo@2x.png), tracking and site-builder placeholders are not addresses.
  if (/\.(png|jpe?g|gif|svg|webp|avif|css|js)$/.test(domain) || /(^|\.)(sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|example\.(com|org|net)|domain\.com|yourdomain\.com|email\.tld)$/.test(domain)) return null;
  if (NEVER_LOCAL.test(local)) return null;
  return value;
}

/** DIRECT reaches a person or the buying desk (jean.dupont@, achat@); GENERIC lands in a shared inbox (contact@, info@). */
export function emailKind(address: string): EmailKind {
  const local = address.slice(0, address.lastIndexOf('@')).split('+')[0];
  if (DIRECT_LOCAL.test(local) || (/^[a-z]+[._-][a-z]+$/.test(local) && !GENERIC_LOCAL.test(local.replace(/[._-]/g, '')))) return 'DIRECT';
  return 'GENERIC';
}

const VERIFY_RANK: Record<string, number> = { VALID: 0, '': 1, UNKNOWN: 2, RISKY: 3, INVALID: 9 };
export type RankedEmail = { address: string; kind: string; verifyStatus: string; bouncedAt?: Date | string | null };
/**
 * The order addresses are tried in: checked-valid first, then not yet checked, then risky; a direct address beats a
 * shared one at the same level, and an address on the company's own domain beats a webmail one. Invalid and bounced
 * addresses come last.
 */
export function rankEmails<T extends RankedEmail>(emails: T[], domain = ''): T[] {
  const weight = (e: T) => (e.bouncedAt ? 10 : VERIFY_RANK[e.verifyStatus] ?? 5) * 4 + (e.kind === 'DIRECT' ? 0 : 2) + (domain && emailDomain(e.address) === domain ? 0 : 1);
  return [...emails].sort((a, b) => weight(a) - weight(b) || a.address.localeCompare(b.address));
}
/** Addresses a mail may go to: checked valid or risky, never bounced. */
export const sendable = (e: RankedEmail) => !e.bouncedAt && (e.verifyStatus === 'VALID' || e.verifyStatus === 'RISKY');
type Checked = RankedEmail & { verifyAttempts?: number };
const attempted = (e: Checked) => e.verifyStatus !== '' || (e.verifyAttempts ?? 0) > 0;
/**
 * Addresses to check now. At most VERIFY_PER_PROSPECT different addresses of a prospect are ever sent to the
 * checker; one whose check failed (UNKNOWN) is retried up to MAX_ATTEMPTS times without using up another slot.
 */
export function addressesToCheck<T extends Checked>(emails: T[], domain = ''): T[] {
  const tried = emails.filter(attempted);
  const retry = tried.filter(e => !e.bouncedAt && (e.verifyStatus === '' || e.verifyStatus === 'UNKNOWN') && (e.verifyAttempts ?? 0) < MAX_ATTEMPTS);
  const fresh = rankEmails(emails.filter(e => !attempted(e) && !e.bouncedAt), domain).slice(0, Math.max(0, VERIFY_PER_PROSPECT - tried.length));
  return [...rankEmails(retry, domain), ...fresh];
}
/**
 * Whether a prospect can be mailed: HAS a sendable address, PENDING while an address may still pass its check,
 * NONE otherwise ("无邮箱" on the card).
 */
export function mailability(emails: Checked[]): 'HAS' | 'PENDING' | 'NONE' {
  if (emails.some(sendable)) return 'HAS';
  return addressesToCheck(emails).length ? 'PENDING' : 'NONE';
}

/** The country's default time zone, or the city's when it is listed (Perth is three hours behind Sydney). */
export function timezoneFor(country: string, city: string, config: RadarConfig) {
  const c = config.countries[country];
  if (!c) return 'UTC';
  const wanted = foldText(city);
  const hit = Object.entries(c.cityTimezones).find(([name]) => foldText(name) === wanted);
  return hit?.[1] ?? c.timezone;
}

// ─── Scoring ────────────────────────────────────────────

/**
 * Contactability (15 points) from the best address: a direct address scores full marks, a shared one less, a risky
 * one less again; without any address a WhatsApp link or a phone number still counts for something.
 */
export function contactabilityScore(emails: Checked[], other: { whatsapp?: string; phone?: string }) {
  const usable = rankEmails(emails.filter(e => !e.bouncedAt && e.verifyStatus !== 'INVALID'));
  const best = usable[0];
  if (best) {
    const direct = best.kind === 'DIRECT';
    if (best.verifyStatus === 'RISKY') return direct ? 8 : 6;
    if (best.verifyStatus === 'VALID') return direct ? 15 : 12;
    return direct ? 13 : 10;
  }
  return other.whatsapp ? 6 : other.phone ? 5 : 0;
}

const clampPart = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(Number.isFinite(value) ? value : 0)));
export function scoreTotal(parts: ScoreParts) {
  return (Object.keys(SCORE_MAX) as (keyof ScoreParts)[]).reduce((sum, key) => sum + clampPart(parts[key], SCORE_MAX[key]), 0);
}
export function clampParts(parts: Partial<ScoreParts>): ScoreParts {
  return Object.fromEntries((Object.keys(SCORE_MAX) as (keyof ScoreParts)[]).map(key => [key, clampPart(parts[key] ?? 0, SCORE_MAX[key])])) as ScoreParts;
}

const squash = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * Facts the AI read on the site, kept only when their quote is really on the site: the personalised opening is
 * written from these alone, so a fact the model made up must never reach a customer.
 */
export function verifiedFacts(facts: { fact: string; quote: string }[], siteText: string | null | undefined) {
  const site = squash(siteText ?? '');
  if (!site) return [];
  return facts.map(f => ({ fact: f.fact.trim().slice(0, 200), quote: f.quote.trim().slice(0, 300) }))
    .filter(f => f.fact && squash(f.quote).length >= 8 && site.includes(squash(f.quote))).slice(0, 2);
}
