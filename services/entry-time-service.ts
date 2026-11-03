import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError, requireAdmin, scope } from '@/lib/auth';
import { isGoodGrade } from '@/lib/analytics';
import { countryCodeOf } from '@/lib/phone-country';
import { ENTRY_CHANNELS, ENTRY_TIME_SOURCE, customerZone, entryChannel, entryLabel, entryOf, inWorkHours, offsetLabel, waitText, workHoursOf, workHoursText } from '@/lib/entry-time';
import { stages } from '@/lib/constants';

const MINUTE = 60_000, DAY = 86_400_000;
const SENT = { notIn: ['FAILED', 'PENDING'] };

export async function workHoursSettings() {
  const s = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { timezone: true, workStartHour: true, workEndHour: true } });
  return { timezone: s.timezone, hours: workHoursOf(s) };
}

const hoursInput = z.object({ start: z.coerce.number().int().min(0).max(23), end: z.coerce.number().int().min(1).max(24) })
  .refine(v => v.start < v.end, '下班时间要晚于上班时间');
/** 工作时间: when the one person answering is at work, in the company's time zone. Administrators only. */
export async function updateWorkHours(user: Actor, input: unknown) {
  requireAdmin(user);
  const v = hoursInput.parse(input);
  await db.setting.update({ where: { id: 'system' }, data: { workStartHour: v.start, workEndHour: v.end } });
  return { hours: v, label: workHoursText(v) };
}

/**
 * The customer's way in and what happened after, in order: 进线 → 评级 → 第一条消息 (how long the lead waited) →
 * 送达 / 已读 → 客户回复 → 报价 → 成交 or 流失. Times are the company's; the entry is also given in the customer's own time.
 */
export async function customerJourney(user: Actor, customerId: string, now = new Date()) {
  const { timezone, hours } = await workHoursSettings();
  const c = await db.customer.findFirst({ where: { id: customerId, ...scope(user) }, select: {
    id: true, name: true, country: true, countryCode: true, phone: true, whatsapp: true, waId: true, source: true, sourceDetail: true,
    inquiryAt: true, createdAt: true, leadGrade: true, leadGradeReason: true, leadGradeSource: true, leadGradedAt: true, stage: true,
    isQualified: true, firstContactAt: true, contactedAt: true, quotedAt: true, lostAt: true, invalidReason: true,
    submissions: { select: { occurredAt: true, ordinal: true }, orderBy: { ordinal: 'asc' } },
    metaLeadEvents: { select: { metaCreatedAt: true, createdAt: true }, take: 1 },
    leadAttributions: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }], take: 1, select: { source: true, adName: true, campaignName: true, formName: true } },
    deals: { select: { dealDate: true }, orderBy: { dealDate: 'asc' }, take: 1 },
    quotations: { where: { status: 'SENT' }, select: { sentAt: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 },
  } });
  if (!c) throw new HttpError(404, '客户不存在或无权查看');
  const entry = entryOf(c, timezone);
  const firstOut = await db.whatsAppMessage.findFirst({ where: { customerId, direction: 'OUTBOUND', status: SENT }, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    select: { sentAt: true, deliveredAt: true, readAt: true, sentById: true } });
  const firstReply = firstOut ? await db.whatsAppMessage.findFirst({ where: { customerId, direction: 'INBOUND', sentAt: { gt: firstOut.sentAt } }, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    select: { sentAt: true, content: true } }) : null;
  const firstInbound = await db.whatsAppMessage.findFirst({ where: { customerId, direction: 'INBOUND' }, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }], select: { sentAt: true, content: true } });

  const attribution = c.leadAttributions[0];
  const channel = entryChannel({ source: c.source, submissions: c.submissions.length, formEvents: c.metaLeadEvents.length, ctwa: attribution?.source === 'CTWA' });
  const ad = attribution?.adName || attribution?.campaignName || attribution?.formName || c.sourceDetail;
  const zone = customerZone(countryCodeOf(c));
  const minutes = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / MINUTE);
  const tone = (m: number) => m <= 30 ? 'fast' as const : m > 120 ? 'slow' as const : 'plain' as const;
  type Step = { title: string; detail: string; at: Date | null; gap?: string; tone?: 'fast' | 'slow' | 'plain'; open?: boolean };
  const steps: Step[] = [];

  const entryDetail = channel === 'FORM' ? `提交广告表单${ad ? ` · ${ad}` : ''}`
    : channel === 'CTWA' ? `点广告后发 WhatsApp${ad ? ` · ${ad}` : ''}${firstInbound ? `：「${firstInbound.content.slice(0, 60)}」` : ''}`
      : channel === 'WHATSAPP' ? `客户直接发 WhatsApp${firstInbound ? `：「${firstInbound.content.slice(0, 60)}」` : ''}` : `手动录入${c.sourceDetail ? ` · ${c.sourceDetail}` : ''}`;
  steps.push({ title: '进线', detail: entryDetail, at: entry.at });
  for (const again of c.submissions.slice(1)) steps.push({ title: `再次进线（第 ${again.ordinal} 次留资）`, detail: '进线时间仍按第一次算', at: again.occurredAt });
  if (c.leadGrade) steps.push({ title: `${c.leadGradeSource === 'AI' ? 'AI' : c.leadGradeSource === 'RULE' ? '按规则' : ''}评级 ${c.leadGrade}`, detail: c.leadGradeReason.slice(0, 120) || '—', at: c.leadGradedAt });

  const contactAt = firstOut?.sentAt ?? c.firstContactAt ?? c.contactedAt;
  if (contactAt) {
    const waited = minutes(entry.at, contactAt);
    steps.push({ title: '第一条消息', detail: firstOut ? (firstOut.sentById ? '在 BOS 里发出' : '手机或历史消息') : '记录的首次联系', at: contactAt,
      gap: entry.estimated ? undefined : `${waited > 5 ? '等了 ' : ''}${waitText(waited)}`, tone: entry.estimated ? undefined : tone(waited) });
    if (firstOut?.readAt) steps.push({ title: '已读', detail: 'WhatsApp 已读回执', at: firstOut.readAt, gap: waitText(minutes(firstOut.sentAt, firstOut.readAt)), tone: 'plain' });
    else if (firstOut?.deliveredAt) steps.push({ title: '已送达', detail: '还没读', at: firstOut.deliveredAt });
  }
  if (firstReply) {
    const from = firstOut?.readAt ?? firstOut?.sentAt ?? firstReply.sentAt;
    const effective = isGoodGrade(c.leadGrade);
    steps.push({ title: '客户回复', detail: `「${firstReply.content.slice(0, 60)}」${effective ? ' → 成为有效客户' : c.leadGrade ? `（${c.leadGrade} 级，不算有效客户）` : ''}`, at: firstReply.sentAt,
      gap: waitText(minutes(from, firstReply.sentAt)), tone: 'plain' });
  }
  const quoteAt = c.quotations[0]?.sentAt ?? c.quotations[0]?.createdAt ?? c.quotedAt;
  if (quoteAt) steps.push({ title: '已报价', detail: '价格来自产品库的报价单', at: quoteAt });
  if (c.deals[0]) steps.push({ title: '成交', detail: `从进线到成交 ${Math.max(0, Math.round((c.deals[0].dealDate.getTime() - entry.at.getTime()) / DAY))} 天`, at: c.deals[0].dealDate });
  else if (['LOST', 'PAUSED', 'INVALID'].includes(c.stage)) steps.push({ title: stages[c.stage as keyof typeof stages], detail: c.invalidReason || '—', at: c.lostAt });
  else if (!contactAt) steps.push({ title: '还没联系', detail: `已经等了 ${waitText(minutes(entry.at, now))}`, at: null, open: true });
  else if (!firstReply) steps.push({ title: '等客户回复', detail: zone ? `客户那边现在是 ${entryLabel(now, zone)}` : '—', at: null, open: true });

  steps.sort((a, b) => (a.at && b.at ? a.at.getTime() - b.at.getTime() : a.at ? -1 : b.at ? 1 : 0));
  return {
    timezone, hours,
    entry: {
      at: entry.at, exact: entry.exact, estimated: entry.estimated,
      company: entryLabel(entry.at, timezone, entry.exact),
      local: zone && entry.exact ? { label: entryLabel(entry.at, zone), zone, offset: offsetLabel(entry.at, zone), country: c.country } : null,
      offHours: entry.exact && !inWorkHours(entry.at, timezone, hours),
      channel, channelLabel: ENTRY_CHANNELS[channel],
      source: entry.estimated ? '没有询盘时间，用录入系统的时间代替（估算），分析里按估算处理' : entry.exact ? ENTRY_TIME_SOURCE[channel] : '只有日期、没有钟点（手动选的日期或导入的表格），按小时的分析不算它',
    },
    steps: steps.map(s => ({ ...s, label: s.at ? entryLabel(s.at, timezone) : '现在' })),
  };
}
export type CustomerJourney = Awaited<ReturnType<typeof customerJourney>>;
