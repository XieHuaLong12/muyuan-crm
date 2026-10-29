import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, scope } from '@/lib/auth';
import { dayKey, localDate, periodRange, type Period } from '@/lib/time';
import { contactNumber } from '@/lib/phone-country';
import { CUSTOMER_SORT_KEYS } from '@/lib/customer-columns';
import { customerGroupWhere } from '@/lib/customer-group';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).default('');
export const customerListQuery = z.object({
  // 新客户 (current) and 旧客户 (legacy) are separate pages; each lists only its own group (lib/customer-group.ts).
  // `all` is for pickers that search every customer, such as starting a chat.
  group: z.enum(['current', 'legacy', 'all']).default('current'),
  q: z.string().trim().max(100).default(''),
  stage: z.string().trim().max(32).default(''),
  country: z.string().trim().max(100).default(''),
  source: z.string().trim().max(40).default(''),
  owner: z.string().trim().max(191).default(''),
  product: z.string().trim().max(100).default(''),
  from: dateKey,
  to: dateKey,
  wonFrom: dateKey,
  wonTo: dateKey,
  qualified: z.enum(['', 'true']).default(''),
  behavior: z.enum(['', 'quoted', 'replied', 'won']).default(''),
  period: z.enum(['', 'WEEK', 'MONTH', 'YEAR']).default(''),
  date: dateKey,
  assign: z.enum(['', 'pending']).default(''),
  grade: z.enum(['', 'A', 'B', 'C', 'D', 'none']).default(''),
  // Every sortable column a user can add in 「定制列」 (lib/customer-columns.ts); productInterest is one of them, so older bookmarked links still open.
  sort: z.enum(['priority', ...CUSTOMER_SORT_KEYS]).default('priority'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().refine(v => [10, 50, 100].includes(v), '每页数量只能是 10、50 或 100').default(10),
});
export type CustomerListQuery = z.infer<typeof customerListQuery>;

function nextDay(key: string) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Inquiry window with the legacy fallback: records without inquiryAt use createdAt. */
function inquiryWindow(range: Prisma.DateTimeFilter): Prisma.CustomerWhereInput {
  return { OR: [{ inquiryAt: range }, { inquiryAt: null, createdAt: range }] };
}

const groupWhere = (group: CustomerListQuery['group']): Prisma.CustomerWhereInput => group === 'all' ? {} : customerGroupWhere(group);
/** Filters that narrow the list (not the page, sort or group): links from dashboards set them. */
const NARROWING = ['q', 'stage', 'country', 'source', 'owner', 'product', 'from', 'to', 'wonFrom', 'wonTo', 'qualified', 'behavior', 'period', 'assign', 'grade'] as const;

function listWhere(user: Actor, q: CustomerListQuery, timezone: string): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [scope(user), groupWhere(q.group)];
  const today = dayKey(new Date(), timezone);
  if (q.stage === 'pending') and.push({ nextFollowUpAt: { lt: localDate(`${nextDay(today)}T00:00`, timezone) } });
  else if (q.stage) and.push({ stage: q.stage });
  if (q.country) and.push({ country: q.country });
  if (q.source) and.push({ source: q.source });
  if (q.owner) and.push({ ownerId: q.owner });
  if (q.assign === 'pending') and.push({ pendingAssignment: true });
  if (q.grade) and.push({ leadGrade: q.grade === 'none' ? '' : q.grade });
  if (q.product) and.push({ OR: [{ productInterest: { contains: q.product } }, { productModel: { contains: q.product } }] });
  if (q.q) {
    and.push({ OR: ['name', 'companyName', 'whatsapp', 'email', 'phone'].map(field => ({ [field]: { contains: q.q } })) });
  }
  if (q.from || q.to) {
    and.push(inquiryWindow({
      ...(q.from ? { gte: localDate(`${q.from}T00:00`, timezone) } : {}),
      ...(q.to ? { lt: localDate(`${nextDay(q.to)}T00:00`, timezone) } : {}),
    }));
  }
  if (q.wonFrom || q.wonTo) {
    and.push({ deals: { some: { dealDate: {
      ...(q.wonFrom ? { gte: localDate(`${q.wonFrom}T00:00`, timezone) } : {}),
      ...(q.wonTo ? { lt: localDate(`${nextDay(q.wonTo)}T00:00`, timezone) } : {}),
    } } } });
  }
  if (q.period && q.date) {
    const range = periodRange(q.period as Period, q.date, timezone);
    and.push(inquiryWindow({ gte: range.start, lt: range.end }));
  }
  if (q.qualified === 'true') and.push({ isQualified: true });
  if (q.behavior === 'quoted') and.push({ isQualified: true, OR: [{ quotedAt: { not: null } }, { stage: 'QUOTED' }] });
  if (q.behavior === 'replied') and.push({ stage: { notIn: ['NEW', 'CONTACTED', 'INVALID'] } });
  if (q.behavior === 'won') and.push({ isQualified: true, deals: { some: {} } });
  return { AND: and };
}

const include = { owner: { select: { name: true } }, deals: { select: { id: true, dealDate: true } } } as const;
/** Grades with their own tab in the list; D (无效) stays in the grade filter. */
export const GRADE_TABS = ['A', 'B', 'C'] as const;

/** Paged customer list. Filtering and sorting happen in the database; only the requested page is loaded. */
export async function customerList(user: Actor, input: unknown) {
  const q = customerListQuery.parse(input);
  const { timezone } = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true } });
  const where = listWhere(user, q, timezone);
  const skip = (q.page - 1) * q.pageSize;
  const group = groupWhere(q.group);
  // A dashboard link (a stage, an owner, a period) counts both groups; say how many of them sit on the other page.
  const other = q.group === 'all' || !NARROWING.some(key => q[key]) ? null : q.group === 'legacy' ? 'current' : 'legacy';
  const [total, otherTotal, countries, pool, grades] = await Promise.all([
    db.customer.count({ where }),
    other ? db.customer.count({ where: listWhere(user, { ...q, group: other }, timezone) }) : Promise.resolve(0),
    db.customer.groupBy({ by: ['country'], where: { AND: [scope(user), group, { country: { not: '' } }] }, orderBy: { country: 'asc' } }),
    user.role === 'ADMIN' ? db.customer.count({ where: { AND: [{ deletedAt: null, pendingAssignment: true }, group] } }) : Promise.resolve(0),
    // A / B / C tabs: how many of the page's customers each automatic form grade holds, whatever the other filters.
    db.customer.groupBy({ by: ['leadGrade'], where: { AND: [scope(user), group, { leadGrade: { in: [...GRADE_TABS] } }] }, _count: { _all: true } }),
  ]);
  let rows;
  if (q.sort === 'priority' || q.sort === 'inquiryAt') {
    // Both orders depend on derived values (due bucket, inquiry fallback); rank the light keys, then load one page.
    const keys = await db.customer.findMany({ where, select: { id: true, nextFollowUpAt: true, inquiryAt: true, createdAt: true } });
    const today = dayKey(new Date(), timezone);
    const bucket = (c: (typeof keys)[number]) => {
      if (!c.nextFollowUpAt) return 2;
      const due = dayKey(c.nextFollowUpAt, timezone);
      return due === today ? 0 : due < today ? 1 : 2;
    };
    const inquiry = (c: (typeof keys)[number]) => (c.inquiryAt ?? c.createdAt).getTime();
    const sign = q.dir === 'asc' ? 1 : -1;
    keys.sort((a, b) => q.sort === 'priority'
      ? bucket(a) - bucket(b) || inquiry(b) - inquiry(a) || a.id.localeCompare(b.id)
      : (inquiry(a) - inquiry(b)) * sign || a.id.localeCompare(b.id));
    const ids = keys.slice(skip, skip + q.pageSize).map(c => c.id);
    const page = await db.customer.findMany({ where: { id: { in: ids } }, include });
    rows = ids.map(id => page.find(c => c.id === id)!).filter(Boolean);
  } else {
    const orderBy: Prisma.CustomerOrderByWithRelationInput = q.sort === 'owner' ? { owner: { name: q.dir } }
      : q.sort === 'deals' ? { deals: { _count: q.dir } }
        : { [q.sort]: q.dir };
    rows = await db.customer.findMany({ where, include, orderBy: [orderBy, { id: 'asc' }], skip, take: q.pageSize });
  }
  return {
    rows: rows.map(c => ({ ...c, contact: contactNumber(c) })), total, otherTotal, page: q.page, pageSize: q.pageSize, countries: countries.map(c => c.country), pool,
    grades: Object.fromEntries(GRADE_TABS.map(grade => [grade, grades.find(g => g.leadGrade === grade)?._count._all ?? 0])) as Record<(typeof GRADE_TABS)[number], number>,
  };
}

/**
 * What the list's side preview shows: the customer, the latest follow-ups and a deal summary — without the WhatsApp
 * history and lead payloads the full profile loads. Same visibility as the list: sales only see their own customers.
 */
export async function customerPreview(id: unknown, user: Actor) {
  const customerId = z.string().trim().min(1).max(191).parse(id);
  const c = await db.customer.findFirst({
    where: { id: customerId, ...scope(user) },
    include: {
      owner: { select: { name: true } },
      deals: { select: { id: true, dealAmount: true, currency: true, dealDate: true }, orderBy: { dealDate: 'desc' } },
      followUps: { select: { id: true, type: true, content: true, followUpAt: true, nextFollowUpAt: true }, orderBy: { followUpAt: 'desc' }, take: 3 },
      _count: { select: { followUps: true, submissions: true } },
    },
  });
  if (!c) throw new HttpError(404, '客户不存在或无访问权限');
  const { _count, ...customer } = c;
  return { ...customer, contact: contactNumber(c), followUpCount: _count.followUps, submissionCount: _count.submissions };
}
