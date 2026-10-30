import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin, scope } from '@/lib/auth';
import { TAG_COLOR_KEYS, TAG_NAME_MAX, type CustomerTagView } from '@/lib/customer-tags';
import { accessible } from './customer-service';

const id = z.string().trim().min(1).max(191);
const name = z.string().trim().min(1, '请填写标签名').max(TAG_NAME_MAX, `标签名最多 ${TAG_NAME_MAX} 个字`);
const color = z.enum(TAG_COLOR_KEYS, { errorMap: () => ({ message: '请选择标签颜色' }) });
const attachInput = z.union([
  z.object({ customerId: id, tagId: id }),
  // A new tag typed in the chat: created and attached in one step.
  z.object({ customerId: id, name, color }),
]);
const detachInput = z.object({ customerId: id, tagId: id });
const tagPatch = z.object({ name: name.optional(), color: color.optional() }).refine(v => v.name !== undefined || v.color !== undefined, '没有要修改的内容');

const duplicate = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const view = (tag: { id: string; name: string; color: string }): CustomerTagView => ({ id: tag.id, name: tag.name, color: tag.color });

/**
 * The shared tag library, with how many customers each is on. A salesperson's counts cover the customers they can
 * see, so the numbers never reveal someone else's customers.
 */
export async function tagLibrary(user: Actor) {
  const [tags, counts] = await Promise.all([
    db.customerTag.findMany({ select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
    db.customerTagLink.groupBy({ by: ['tagId'], where: { customer: scope(user) }, _count: { _all: true } }),
  ]);
  const count = new Map(counts.map(row => [row.tagId, row._count._all]));
  return { tags: tags.map(tag => ({ ...view(tag), count: count.get(tag.id) ?? 0 })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')) };
}

/** Tags of a set of customers, for lists: customer id → its tags in name order. */
export async function tagsOf(customerIds: string[]) {
  const byCustomer = new Map<string, CustomerTagView[]>();
  if (!customerIds.length) return byCustomer;
  const links = await db.customerTagLink.findMany({ where: { customerId: { in: customerIds } }, select: { customerId: true, tag: { select: { id: true, name: true, color: true } } },
    orderBy: [{ createdAt: 'asc' }, { tagId: 'asc' }] });
  for (const link of links) byCustomer.set(link.customerId, [...byCustomer.get(link.customerId) ?? [], view(link.tag)]);
  return byCustomer;
}

/** Puts a tag on a customer; a name that is not in the library yet becomes a new tag (anyone may add one). */
export async function tagCustomer(input: unknown, user: Actor) {
  const v = attachInput.parse(input);
  await accessible(v.customerId, user);
  let tag: { id: string; name: string; color: string } | null;
  if ('tagId' in v) {
    tag = await db.customerTag.findUnique({ where: { id: v.tagId }, select: { id: true, name: true, color: true } });
    if (!tag) throw new HttpError(404, '标签不存在，可能已被删除');
  } else {
    // Two people creating the same name at once end up with one tag.
    tag = await db.customerTag.findUnique({ where: { name: v.name }, select: { id: true, name: true, color: true } })
      ?? await db.customerTag.create({ data: { name: v.name, color: v.color, createdBy: user.id }, select: { id: true, name: true, color: true } })
        .catch(async error => { if (duplicate(error)) return db.customerTag.findUniqueOrThrow({ where: { name: v.name }, select: { id: true, name: true, color: true } }); throw error; });
  }
  await db.customerTagLink.createMany({ data: [{ customerId: v.customerId, tagId: tag.id, createdBy: user.id }], skipDuplicates: true });
  return { tag: view(tag), tags: (await tagsOf([v.customerId])).get(v.customerId) ?? [] };
}

export async function untagCustomer(input: unknown, user: Actor) {
  const v = detachInput.parse(input);
  await accessible(v.customerId, user);
  await db.customerTagLink.deleteMany({ where: { customerId: v.customerId, tagId: v.tagId } });
  return { tags: (await tagsOf([v.customerId])).get(v.customerId) ?? [] };
}

/** Renaming or recolouring changes the tag on every customer at once, so only administrators manage the library. */
export async function updateTag(tagId: string, input: unknown, user: Actor) {
  requireAdmin(user, '标签由管理员统一改名、换色');
  const v = tagPatch.parse(input);
  try {
    const tag = await db.customerTag.update({ where: { id: id.parse(tagId) }, data: v, select: { id: true, name: true, color: true } });
    return { tag: view(tag) };
  } catch (error) {
    if (duplicate(error)) throw new HttpError(409, `已经有叫「${v.name}」的标签`);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new HttpError(404, '标签不存在，可能已被删除');
    throw error;
  }
}

/** Deleting a tag only takes it off the customers; nothing else about them changes. */
export async function deleteTag(tagId: string, user: Actor) {
  requireAdmin(user, '标签由管理员统一删除');
  const removed = await db.customerTag.deleteMany({ where: { id: id.parse(tagId) } });
  if (!removed.count) throw new HttpError(404, '标签不存在，可能已被删除');
  return { deleted: true };
}
