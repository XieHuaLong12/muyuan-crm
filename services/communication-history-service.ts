import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,scope,requireAdmin } from '@/lib/auth';

export const communicationHistoryQuery = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  customer: z.string().trim().min(1).max(191).optional(),
  before: z.string().trim().min(1).max(191).optional(),
  ownerId: z.string().trim().max(191).default(''),
});

const PAGE_SIZE = 30;
const archiveMessageSelect = { id: true, content: true, direction: true, status: true, sentAt: true,
  source: true, messageType: true, mediaUrl: true, fileName: true, attachmentMetadata: true } as const;

/** 只读取已有消息，按真实消息时间排序；本地导入不会更新 Customer.lastWhatsAppAt。 */
export async function communicationHistory(user: Actor, input: unknown) {
  requireAdmin(user);
  const query = communicationHistoryQuery.parse(input);
  const search: Prisma.CustomerWhereInput = query.q ? { OR: [
    { name: { contains: query.q } }, { companyName: { contains: query.q } },
    { country: { contains: query.q } }, { whatsapp: { contains: query.q } },
  ] } : {};
  const customerWhere: Prisma.CustomerWhereInput = { AND: [scope(user), search, ...(query.ownerId ? [{ownerId:query.ownerId}] : [])] };
  const [groups, total] = await Promise.all([
    db.whatsAppMessage.groupBy({
      by: ['customerId'], where: { customer: { is: customerWhere } },
      _max: { sentAt: true }, _count: { _all: true },
      orderBy: [{ _max: { sentAt: 'desc' } }, { customerId: 'asc' }],
      skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE,
    }),
    db.customer.count({ where: { AND: [customerWhere, { whatsappMessages: { some: {} } }] } }),
  ]);

  const ids = groups.map(group => group.customerId);
  const customers = ids.length ? await db.customer.findMany({
    where: { AND: [customerWhere, {id:{in:ids}}] },
    select: { id: true, name: true, companyName: true, country: true,
      owner: {select:{id:true,name:true}},
      whatsappMessages: { orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 1,
        select: { content: true, direction: true, fileName: true, messageType: true } } },
  }) : [];
  const byId = new Map(customers.map(customer => [customer.id, customer]));
  const conversations = groups.flatMap(group => {
    const customer = byId.get(group.customerId);
    return customer ? [{ ...customer, messageCount: group._count._all,
      lastMessageAt: group._max.sentAt, lastMessage: customer.whatsappMessages[0] ?? null }] : [];
  });

  const selectedId = query.customer || conversations[0]?.id;
  const selected = selectedId ? await db.customer.findFirst({
    where: { AND: [scope(user), ...(query.ownerId?[{ownerId:query.ownerId}]:[]), {id:selectedId,whatsappMessages:{some:{}}}] },
    select: { id: true, name: true, companyName: true, country: true, stage: true, owner:{select:{id:true,name:true}} },
  }) : null;
  const cursor = selected && query.before ? await db.whatsAppMessage.findFirst({
    where: { id: query.before, customerId: selected.id }, select: { id: true },
  }) : null;
  const rows = selected ? await db.whatsAppMessage.findMany({
    where: { customerId: selected.id }, select: archiveMessageSelect,
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 51,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
  }) : [];
  const messages = rows.slice(0, 50);
  const nextCursor = rows.length > 50 ? messages.at(-1)?.id ?? null : null;
  const sales=await db.user.findMany({where:{role:'SALES'},select:{id:true,name:true,isActive:true},orderBy:[{isActive:'desc'},{name:'asc'}]});
  return { query, pageSize: PAGE_SIZE, total, conversations, selected, sales,
    messages: messages.reverse(), nextCursor,
    viewingOlder: !!cursor };
}

export type CommunicationHistoryData = Awaited<ReturnType<typeof communicationHistory>>;
