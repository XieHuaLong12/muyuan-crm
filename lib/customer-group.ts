import type { Prisma } from '@prisma/client';
import { inquiryDate } from './customer-date';

/**
 * 新客户 / 旧客户. Customers who first inquired before 2026-10-01 (Beijing time) are 旧客户: they stay fully usable
 * (chat, quotations, orders, deals), but script testing (触达记录、话术效果) and the work queues count only 新客户, so
 * the experiment starts on a clean set. Decided by the inquiry date (the creation time when there is none), so nothing
 * is stored or moved: an old lead imported later lands with the old ones, and an old customer writing again stays old.
 *
 * Both conditions are an `OR`: combine them with others inside `AND: [...]`, never by spreading into an object that
 * may carry its own `OR`.
 */
export const NEW_CUSTOMERS_FROM = new Date('2026-10-01T00:00:00+08:00');
export type CustomerGroup = 'current' | 'legacy';

export const isLegacyCustomer = (c: { inquiryAt?: Date | string | null; createdAt: Date | string }) =>
  new Date(inquiryDate(c)).getTime() < NEW_CUSTOMERS_FROM.getTime();

export const currentCustomers: Prisma.CustomerWhereInput = { OR: [{ inquiryAt: { gte: NEW_CUSTOMERS_FROM } }, { inquiryAt: null, createdAt: { gte: NEW_CUSTOMERS_FROM } }] };
export const legacyCustomers: Prisma.CustomerWhereInput = { OR: [{ inquiryAt: { lt: NEW_CUSTOMERS_FROM } }, { inquiryAt: null, createdAt: { lt: NEW_CUSTOMERS_FROM } }] };
export const customerGroupWhere = (group: CustomerGroup) => group === 'legacy' ? legacyCustomers : currentCustomers;
