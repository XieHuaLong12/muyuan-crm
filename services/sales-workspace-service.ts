import { cache } from 'react';
import { db } from '@/lib/db';
import { Actor, scope } from '@/lib/auth';
import { dayKey } from '@/lib/time';
import { listTasks, taskScope } from './task-service';
import { getReminders } from './workflow-service';

export const workspaceBootstrap = cache(async (user: Actor) => ({ user,
  users: await db.user.findMany({ where: user.role === 'ADMIN' ? {} : { id: user.id }, select: { id: true, name: true, email: true, role: true,isActive:true } }),
  settings: await db.setting.findUniqueOrThrow({ where: { id: 'system' } }).then(s=>({...s,usdCnyRate:s.usdCnyRate.toString()})),
  webhookConfigured: !!process.env.WEBHOOK_SECRET, deepseekConfigured: !!process.env.DEEPSEEK_API_KEY,
}));
export async function priorityCustomers(user: Actor) {
  const now = Date.now();
  const rows = await db.customer.findMany({ where: scope(user), select: {
    id:true, name:true, companyName:true, country:true, whatsapp:true, stage:true, aiScore:true, aiIntent:true, aiNextAction:true,
    estimatedOrderValue:true, currency:true, lastInboundAt:true, lastOutboundAt:true, nextFollowUpAt:true,
    _count: { select: { quotations: { where: { status: 'DRAFT' } } } },
    readStates: { where: { userId: user.id }, select: { readAt:true } },
    whatsappMessages: { where: user.role==='ADMIN'?{}:{id:{in:[]}}, orderBy: [{ sentAt:'desc' }, { id:'desc' }], take:1, select: { content:true } },
  } });
  return rows.map(c => {
    const terminal = ['WON','LOST','INVALID','PAUSED'].includes(c.stage);
    const unread = !!c.lastInboundAt && (!c.readStates[0] || c.lastInboundAt > c.readStates[0].readAt);
    const needsReply = !!c.lastInboundAt && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt);
    const overdue = !!c.nextFollowUpAt && c.nextFollowUpAt.getTime()<now || needsReply && now-c.lastInboundAt!.getTime()>=86400000;
    // Only use a capped logarithmic amount signal; never aggregate mixed currencies.
    const amount = Math.min(12, Math.log10(1+Number(c.estimatedOrderValue))*2);
    const priorityScore = (terminal ? -1000 : 0) + c.aiScore + (c.aiIntent==='HIGH'?25:0) + (needsReply?30:0) + (overdue?40:0) + (unread?15:0) + amount;
    const { readStates, whatsappMessages, _count, ...customer } = c; void readStates;
    return { ...customer, estimatedOrderValue: String(c.estimatedOrderValue), draftQuotes: _count.quotations, unread, needsReply, overdue, priorityScore,
      latestMessage: user.role==='ADMIN'?(whatsappMessages[0]?.content || ''):'', lastInboundAt:c.lastInboundAt?.toISOString()||null,
      lastOutboundAt:c.lastOutboundAt?.toISOString()||null, nextFollowUpAt:c.nextFollowUpAt?.toISOString()||null };
  }).sort((a,b)=>b.priorityScore-a.priorityScore || a.name.localeCompare(b.name));
}
export async function salesHome(user: Actor) {

  const [customers, tasks, notices, boot, overdueTasks, quotesWaiting] = await Promise.all([
    priorityCustomers(user), listTasks(user,{status:'OPEN',view:'TODAY'}),getReminders(user),workspaceBootstrap(user),
    db.task.count({where:{...taskScope(user),status:{not:'DONE'},dueDate:{lt:new Date()}}}),
    db.quotation.count({where:{customer:scope(user),status:'DRAFT'}}),
  ]);
  return { counts: { needsReply:customers.filter(c=>c.needsReply).length, overdue:overdueTasks,
    todayTasks:tasks.total, unread:customers.filter(c=>c.unread).length, quotesWaiting, reminders:notices.length },
    customers:customers.slice(0,8),recent:[...customers].filter(c=>c.lastInboundAt||c.lastOutboundAt).sort((a,b)=>
      Math.max(Date.parse(b.lastInboundAt||'')||0,Date.parse(b.lastOutboundAt||'')||0)-Math.max(Date.parse(a.lastInboundAt||'')||0,Date.parse(a.lastOutboundAt||'')||0)).slice(0,5),
    tasks:tasks.tasks.slice(0,8),notices:notices.slice(0,5),today:dayKey(new Date(),boot.settings.timezone) };
}
export const customerDetail = cache(async (id:string,user:Actor) => db.customer.findFirst({ where:{id,...scope(user)},include:{
  owner:{select:{name:true}},deals:{orderBy:{dealDate:'desc'}},followUps:{orderBy:{followUpAt:'desc'}},stageHistory:{orderBy:{changedAt:'desc'}},submissions:{orderBy:{ordinal:'desc'}},intelligence:true,
} }));
export function serializable<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
