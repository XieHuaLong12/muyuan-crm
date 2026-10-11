import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { QUOTE_LANGUAGES, type FxRates, type QuoteLanguage } from '@/lib/quote-math';
import { DEFAULT_TEMPLATES, type QuoteTemplateText } from '@/lib/quote-i18n';

/**
 * 报价设置：每种语言一套抬头 / 条款 / 说明，以及报价用的汇率。
 * 读取不落库（没有记录就用默认文案），只有管理员保存时才写入。
 */

const text = (max: number, label: string) => z.string().trim().min(1, `请填写${label}`).max(max, `${label}最多 ${max} 个字`);

const templateInput = z.object({
  language: z.enum(QUOTE_LANGUAGES),
  title: text(120, '单据标题'),
  companyLine: text(300, '公司抬头'),
  contactLine: text(400, '联系方式'),
  paymentTerms: text(400, '付款方式'),
  leadTime: text(400, '生产周期'),
  moq: text(400, '起订量'),
  packing: text(400, '包装方式'),
  warranty: text(400, '质保'),
  priceBasis: text(400, '价格说明'),
  notes: text(4000, '报价说明'),
  footer: text(200, '页脚'),
  preparedByRole: text(60, '制单人职务'),
  unitLabel: text(20, '默认单位'),
  validDays: z.coerce.number().int('有效天数必须是整数').min(1, '有效天数至少 1 天').max(365, '有效天数最多 365 天'),
});

const ratesInput = z.object({
  usdCny: z.coerce.number().gt(0, '美元汇率必须大于 0').max(100, '美元汇率过大'),
  eurCny: z.preprocess(v => (v === '' || v === undefined ? null : v), z.coerce.number().gt(0, '欧元汇率必须大于 0').max(100, '欧元汇率过大').nullable()),
});

export type QuoteTemplates = Record<QuoteLanguage, QuoteTemplateText & { customized: boolean }>;

export async function quoteTemplates(): Promise<QuoteTemplates> {
  const rows = await db.quoteTemplate.findMany();
  const result = {} as QuoteTemplates;
  for (const language of QUOTE_LANGUAGES) {
    const row = rows.find(r => r.language === language);
    result[language] = row
      ? {
          title: row.title, companyLine: row.companyLine, contactLine: row.contactLine, paymentTerms: row.paymentTerms,
          leadTime: row.leadTime, moq: row.moq, packing: row.packing, warranty: row.warranty, priceBasis: row.priceBasis,
          notes: row.notes, footer: row.footer, preparedByRole: row.preparedByRole, unitLabel: row.unitLabel, validDays: row.validDays,
          customized: true,
        }
      : { ...DEFAULT_TEMPLATES[language], customized: false };
  }
  return result;
}

export async function quoteFxRates(): Promise<FxRates> {
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { usdCnyRate: true, eurCnyRate: true } });
  return { usdCny: Number(setting.usdCnyRate), eurCny: setting.eurCnyRate === null ? null : Number(setting.eurCnyRate) };
}

export async function quoteSettings(user: Actor) {
  void user;
  const [templates, fx] = await Promise.all([quoteTemplates(), quoteFxRates()]);
  return { templates, fx };
}

export async function saveQuoteTemplate(user: Actor, input: unknown) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '只有管理员可以修改报价模板');
  const { language, ...v } = templateInput.parse(input);
  await db.quoteTemplate.upsert({
    where: { language },
    create: { language, ...v, updatedBy: user.id },
    update: { ...v, updatedBy: user.id },
  });
  return (await quoteTemplates())[language];
}

/** 美元汇率与产品毛利共用 Setting.usdCnyRate，改一处两边一致。 */
export async function saveQuoteRates(user: Actor, input: unknown) {
  if (user.role !== 'ADMIN') throw new HttpError(403, '只有管理员可以修改汇率');
  const v = ratesInput.parse(input);
  await db.setting.update({
    where: { id: 'system' },
    data: {
      usdCnyRate: new Prisma.Decimal(v.usdCny.toFixed(4)),
      eurCnyRate: v.eurCny === null ? null : new Prisma.Decimal(v.eurCny.toFixed(4)),
    },
  });
  return quoteFxRates();
}
