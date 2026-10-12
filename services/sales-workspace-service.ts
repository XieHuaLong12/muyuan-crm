import { cache } from 'react';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';

export const workspaceBootstrap = cache(async (user: Actor) => ({ user,
  users: await db.user.findMany({ where: user.role === 'ADMIN' ? {} : { id: user.id }, select: { id: true, name: true, email: true, role: true,isActive:true } }),
  settings: await db.setting.findUniqueOrThrow({ where: { id: 'system' } }).then(s=>({...s,usdCnyRate:s.usdCnyRate.toString(),eurCnyRate:s.eurCnyRate?.toString()??null})),
  webhookConfigured: !!process.env.WEBHOOK_SECRET, deepseekConfigured: !!process.env.DEEPSEEK_API_KEY,
}));
export const customerDetail = cache(async (id:string,user:Actor) => db.customer.findFirst({ where:{id,...scope(user)},include:{
  owner:{select:{name:true}},deals:{orderBy:{dealDate:'desc'}},followUps:{orderBy:{followUpAt:'desc'}},stageHistory:{orderBy:{changedAt:'desc'}},submissions:{orderBy:{ordinal:'desc'}},intelligence:true,
} }));
