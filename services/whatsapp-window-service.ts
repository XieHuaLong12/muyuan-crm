import { z } from 'zod';
import { Actor, HttpError } from '@/lib/auth';
import { db } from '@/lib/db';
import { gupshupSource } from '@/lib/gupshup';
import { accessible } from './customer-service';

export function serviceWindow(lastCustomerMessageAt: Date | null, now = new Date()) {
  const expiresAt = lastCustomerMessageAt ? new Date(lastCustomerMessageAt.getTime() + 86400000) : null;
  return { lastCustomerMessageAt, conversationWindowExpiresAt: expiresAt,
    conversationWindowStatus: !expiresAt || lastCustomerMessageAt! > now ? 'UNKNOWN' as const : expiresAt > now ? 'OPEN' as const : 'CLOSED' as const };
}

export async function customerServiceWindow(customerId: string, user: Actor, account?: {provider:string; accountId:string}) {
  z.string().trim().min(1).max(191).parse(customerId);
  await accessible(customerId, user);
  const target = account || {provider:'gupshup',accountId:gupshupSource() || 'NOT_CONNECTED'};
  const conversation = await db.whatsAppConversation.findFirst({where:{contact:{customerId,provider:target.provider,accountId:target.accountId,
    status:{in:['MATCHED','MANUAL']}},lastCustomerMessageAt:{not:null}},orderBy:{lastCustomerMessageAt:'desc'},select:{id:true,lastCustomerMessageAt:true}});
  return { ...serviceWindow(conversation?.lastCustomerMessageAt || null), provider:target.provider, providerAccountId:target.accountId, conversationId:conversation?.id || null };
}

export async function requireOpenWindow(customerId:string,user:Actor,account:{provider:string;accountId:string}) {
  const window = await customerServiceWindow(customerId,user,account);
  if(window.conversationWindowStatus !== 'OPEN') throw new HttpError(409,'此业务号码的 24 小时窗口已关闭或尚无真实入站证据，请使用已审核模板');
  return window;
}
