import { z } from 'zod';

/**
 * Script effectiveness: which icebreaker gets answered (docs/OUTREACH_AND_WORKBENCH.md). Everything here is pure:
 * grouping messages into touches, the conversation state machine, reply attribution, the win probability and the
 * focus signals. The services feed it database rows and persist what it derives, so the same history always gives
 * the same touches and the rules can be tested without a database.
 */

// ───────────────────────── Labels ─────────────────────────

export const POSITIONS = ['T0', 'T1', 'T2', 'T3', 'T4', 'R1', 'R2', 'R3'] as const;
export type Position = (typeof POSITIONS)[number];
export const POSITION_LABELS: Record<Position, string> = {
  T0: 'T0 首回', T1: 'T1 第1次跟进', T2: 'T2 第2次跟进', T3: 'T3 第3次跟进', T4: 'T4 第4次跟进',
  R1: 'R1 第1次唤醒', R2: 'R2 第2次唤醒', R3: 'R3 第3次唤醒',
};
export const SCRIPT_STATUSES = { TESTING: '测试中', WINNER: '胜出', RETIRED: '停用' } as const;
/** Set only by 删除 in the library, never chosen as a status: the script is gone from the library, rotation and every number. */
export const DELETED_SCRIPT = 'DELETED';
export type ScriptStatus = keyof typeof SCRIPT_STATUSES;
export const SCRIPT_LANGUAGES = { en: '英语', fr: '法语', ar: '阿拉伯语' } as const;
export type ScriptLanguage = keyof typeof SCRIPT_LANGUAGES;
export const GRADES = ['A', 'B', 'C'] as const;
export type Grade = (typeof GRADES)[number];

export const OUTREACH_STATES = { ICEBREAK: '破冰期', CONVERSING: '对话中', SILENT: '沉默期', DORMANT: '沉睡', STOPPED: '停止联系' } as const;
export type OutreachState = keyof typeof OUTREACH_STATES;
export const MATCH_TYPES = { EXACT: '原样', LIGHT: '轻改', HEAVY: '大幅改写', FREE: '自由发挥' } as const;
export type MatchType = keyof typeof MATCH_TYPES;
/** Only these count towards a script's numbers; heavy rewrites and free text are "非标准话术". */
export const COUNTED_MATCHES: readonly MatchType[] = ['EXACT', 'LIGHT'];
export const INTENTS = { GREETING: '破冰问候', PRODUCT: '产品介绍', QUOTE: '报价', ANSWER: '回答客户问题', SAMPLE: '寄样或验厂', NUDGE: '催促唤醒', OTHER: '其他' } as const;
export type Intent = keyof typeof INTENTS;
export const CHANNELS = { BOS_FREE: 'BOS自由消息', BOS_TEMPLATE: 'BOS模板消息', PHONE: '手机端' } as const;
export type Channel = keyof typeof CHANNELS;

export const QUALITIES = { HIGH: '高意向', ENGAGED: '有效互动', LOW: '低意向', REJECT: '拒绝', INVALID: '无效' } as const;
export type Quality = keyof typeof QUALITIES;
export const QUALITY_RANK: Record<Quality, number> = { HIGH: 4, ENGAGED: 3, LOW: 2, REJECT: 1, INVALID: 0 };
/** 24h reply: every quality except INVALID (an auto-reply is not a reply). Effective reply: HIGH and ENGAGED. */
export const isReply = (quality: string) => quality !== '' && quality !== 'INVALID';
export const isEffective = (quality: string) => quality === 'HIGH' || quality === 'ENGAGED';

export const SIGNAL_GROUPS = [
  { label: '采购信号', signals: { ASK_PRICE: '问价格', ASK_MOQ: '问起订量', ASK_SHIPPING: '问运费或交期', QUANTITY: '报出数量', ASK_SAMPLE: '要样品', VISIT: '约看厂或见面' } },
  { label: '客户画像', signals: { STORE: '提到门店或公司', ECOMMERCE: '电商卖家', PERSONAL: '零售自用', MARKET: '提到目标市场' } },
  { label: '顾虑', signals: { PRICE_OBJECTION: '价格异议', QUALITY_CONCERN: '担心质量', PAYMENT_CONCERN: '担心付款安全', HAS_SUPPLIER: '已有供应商' } },
  { label: '处理', signals: { STOP_CONTACT: '要求停止联系', NEEDS_HUMAN: '需人工查看' } },
] as const;
export const SIGNALS: Record<string, string> = Object.assign({}, ...SIGNAL_GROUPS.map(group => group.signals));
export type Signal = keyof typeof SIGNALS;
export const SIGNAL_KEYS = Object.keys(SIGNALS) as [string, ...string[]];

export const OVERRIDE_FIELDS = { SCRIPT: '话术编号', MATCH_TYPE: '匹配类型', QUALITY: '回复质量', SIGNALS: '信号标签', GRADE: '等级建议' } as const;
export const OVERRIDE_REASONS = { VOICE_IMAGE: '语音或图片人工判定', AI_WRONG: 'AI判错', CONTEXT: '补充了上下文', OTHER: '其他' } as const;
export const CATEGORIES = { CONVERT: '转化', FRONTEND: '前端', DATA: '数据' } as const;
export type Category = keyof typeof CATEGORIES;

const keys = <T extends Record<string, unknown>>(record: T) => Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];
export const positionEnum = z.enum(POSITIONS);
export const scriptStatusEnum = z.enum(keys(SCRIPT_STATUSES));
export const languageEnum = z.enum(keys(SCRIPT_LANGUAGES));
export const gradeEnum = z.enum(GRADES);
export const qualityEnum = z.enum(keys(QUALITIES));
export const matchTypeEnum = z.enum(keys(MATCH_TYPES));
export const intentEnum = z.enum(keys(INTENTS));
export const signalEnum = z.enum(SIGNAL_KEYS);
export const categoryEnum = z.enum(keys(CATEGORIES));
export const channelEnum = z.enum(keys(CHANNELS));

// ───────────────────────── Parameters ─────────────────────────

const days = z.array(z.coerce.number().min(0).max(90)).length(4);
/** Every threshold the requirement calls a default is a parameter (Setting.outreachConfig); these are the defaults. */
export const configSchema = z.object({
  groupMinutes: z.coerce.number().int().min(1).max(60).default(10),
  silentHours: z.coerce.number().int().min(1).max(720).default(72),
  dormantDays: z.coerce.number().int().min(1).max(90).default(7),
  followUpDays: days.default([1, 3, 7, 14]),
  reviveDays: z.array(z.coerce.number().min(0).max(90)).length(3).default([0, 3, 7]),
  minTouchGapHours: z.coerce.number().min(0).max(168).default(24),
  templateCap: z.coerce.number().int().min(1).max(20).default(2),
  reviewConfidence: z.coerce.number().min(0).max(1).default(0.7),
  minSample: z.coerce.number().int().min(1).max(1000).default(30),
  winProbability: z.coerce.number().min(0.5).max(1).default(0.9),
  loseProbability: z.coerce.number().min(0).max(0.5).default(0.1),
  nonStandardShare: z.coerce.number().min(0).max(1).default(0.3),
  nonStandardMinTouches: z.coerce.number().int().min(1).max(1000).default(5),
  overrideRate: z.coerce.number().min(0).max(1).default(0.15),
  firstReplyMinutes: z.coerce.number().int().min(1).max(1440).default(5),
  hotReplyHours: z.coerce.number().min(0.5).max(72).default(2),
  replyRateDropPoints: z.coerce.number().min(0).max(100).default(5),
  replyRateMinSample: z.coerce.number().int().min(1).max(1000).default(10),
  businessShareDropPoints: z.coerce.number().min(0).max(100).default(10),
  hotBacklogHours: z.coerce.number().min(1).max(720).default(24),
  staleQuoteDays: z.coerce.number().int().min(1).max(90).default(7),
  staleQuoteCount: z.coerce.number().int().min(1).max(100).default(3),
  slowFirstReplyCount: z.coerce.number().int().min(1).max(100).default(3),
  energyDeviationPoints: z.coerce.number().min(0).max(100).default(15),
  energyMinItems: z.coerce.number().int().min(1).max(100).default(5),
  energyTargets: z.object({ CONVERT: z.coerce.number().min(0).max(100), FRONTEND: z.coerce.number().min(0).max(100), DATA: z.coerce.number().min(0).max(100) })
    .refine(t => Math.round(t.CONVERT + t.FRONTEND + t.DATA) === 100, '精力目标三项之和须为 100%').default({ CONVERT: 60, FRONTEND: 20, DATA: 20 }),
});
export type OutreachConfig = z.infer<typeof configSchema>;
/** Stored parameters with defaults filled in; a stored value that no longer validates falls back to the default. */
export function readConfig(stored: unknown): OutreachConfig {
  const parsed = configSchema.safeParse(stored && typeof stored === 'object' ? stored : {});
  return parsed.success ? parsed.data : configSchema.parse({});
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// ───────────────────────── Scripts ─────────────────────────

/** "T0-A1" → "T0-A2": the next free version of a code, keeping its position and letter. */
export function nextVersionCode(code: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const match = /^(.*?)(\d+)$/.exec(code);
  const stem = match ? match[1] : `${code}-`;
  let n = match ? Number(match[2]) + 1 : 1;
  while (used.has(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}

// Countries written to in French (France, Belgium, Switzerland, the Maghreb, French-speaking Africa, overseas France)
// and in Arabic (the Gulf, the Levant, Egypt, Libya, Sudan, Mauritania), by ISO code.
const FRENCH_COUNTRIES = new Set(['FR', 'BE', 'CH', 'LU', 'MC', 'MA', 'DZ', 'TN', 'SN', 'CI', 'CM', 'ML', 'BF', 'NE', 'TD', 'GN', 'BJ', 'TG', 'GA', 'CG', 'CD',
  'MG', 'DJ', 'KM', 'CF', 'BI', 'RW', 'HT', 'MU', 'SC', 'RE', 'GP', 'MQ', 'GF', 'YT', 'PF', 'NC', 'PM', 'WF', 'BL', 'MF']);
const ARABIC_COUNTRIES = new Set(['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'YE', 'IQ', 'JO', 'LB', 'SY', 'PS', 'EG', 'LY', 'SD', 'MR']);

/**
 * The script's language for a customer: the profile language when it names one we write in; else the language of
 * the customer's country (most leads have a country from their number but no language); else English.
 */
export function customerScriptLanguage(language: string, countryCode = ''): ScriptLanguage {
  const code = countryCode.trim().toUpperCase();
  return profileLanguage(language) ?? (FRENCH_COUNTRIES.has(code) ? 'fr' : ARABIC_COUNTRIES.has(code) ? 'ar' : 'en');
}
/** The language the customer profile names, when it is one we write scripts in. */
export function profileLanguage(language: string): ScriptLanguage | null {
  const text = language.trim().toLowerCase();
  return /^fr|french|français|francais|法/.test(text) ? 'fr' : /^ar|arab|عرب|阿拉伯/.test(text) ? 'ar' : /^en|english|英/.test(text) ? 'en' : null;
}

export const gradesOf = (grades: string) => grades.split(',').map(g => g.trim()).filter((g): g is Grade => (GRADES as readonly string[]).includes(g));

/**
 * Variables a script may use, in single or double braces ({客户名} or {{客户名称}}), with the other names people
 * write them under. Templates use {{1}}… instead and are filled in the template panel.
 */
export const SCRIPT_VARIABLES = { '客户名': 'firstName', '国家': 'country', '产品': 'product', '数量': 'quantity', '业务员': 'owner' } as const;
const VARIABLE_ALIASES: Record<string, keyof ScriptFacts> = {
  '客户名称': 'firstName', '客户姓名': 'firstName', '名字': 'firstName', '目标市场': 'country', '市场': 'country', '意向产品': 'product', '采购数量': 'quantity', '销售': 'owner',
};
const VARIABLE = /\{\{\s*([^{}]{1,20}?)\s*\}\}|\{([^{}]{1,20})\}/g;
/** Each value already in the script's language. */
export type ScriptFacts = { firstName: string; country: string; product: string; owner: string; quantity: string };
const factOf = (name: string): keyof ScriptFacts | undefined => SCRIPT_VARIABLES[name as keyof typeof SCRIPT_VARIABLES] ?? VARIABLE_ALIASES[name];
/** The script as the customer would read it; a variable the record cannot fill stays visible for the salesperson. */
export function renderScript(content: string, facts: ScriptFacts) {
  return content.replace(VARIABLE, (whole, double: string | undefined, single: string | undefined) => {
    const key = factOf((double ?? single ?? '').trim());
    return key && facts[key] ? facts[key] : whole;
  });
}

/** A country's name in the script's language: 法国 → « France », « فرنسا ». */
export function countryIn(code: string, language: ScriptLanguage) {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  try { return new Intl.DisplayNames([language], { type: 'region' }).of(code) ?? ''; } catch { return ''; }
}
// The product lines named in the first-touch templates (lib/constants.ts FIRST_TOUCH_PRODUCT_LINES), in French and Arabic.
const PRODUCT_LINES: Record<string, Record<Exclude<ScriptLanguage, 'en'>, string>> = {
  'compressed sofas': { fr: 'canapés compressés', ar: 'الكنب المضغوط' },
  'vacuum-packed mattresses': { fr: 'matelas compressés sous vide', ar: 'المراتب المضغوطة' },
  'smart electric mattresses': { fr: 'matelas électriques intelligents', ar: 'المراتب الكهربائية الذكية' },
};
export const productLineIn = (line: string, language: ScriptLanguage) => !line || language === 'en' ? line : PRODUCT_LINES[line]?.[language] ?? '';
const UNITS: Record<ScriptLanguage, { piece: string; set: string }> = { en: { piece: 'pieces', set: 'sets' }, fr: { piece: 'pièces', set: 'ensembles' }, ar: { piece: 'قطعة', set: 'طقم' } };
/** A quantity the buyer gave (lib/lead-answers.ts), written in the script's language: « 1 à 5 pièces ». */
export function quantityIn(quantity: { min: number | null; container: boolean; label: string; sets?: boolean } | null, language: ScriptLanguage) {
  if (!quantity) return '';
  if (quantity.container) {
    const n = Number(/^(\d+)/.exec(quantity.label)?.[1] ?? 0);
    if (language === 'fr') return n ? `${n} conteneur${n > 1 ? 's' : ''}` : 'un conteneur complet';
    if (language === 'ar') return n ? `${n} حاوية` : 'حاوية كاملة';
    return n ? `${n} container${n > 1 ? 's' : ''}` : 'a full container';
  }
  if (!quantity.min) return '';
  const unit = UNITS[language][quantity.sets ? 'set' : 'piece'];
  const range = /^(\d+)–(\d+)/.exec(quantity.label);
  if (range) return language === 'fr' ? `${range[1]} à ${range[2]} ${unit}` : `${range[1]}–${range[2]} ${unit}`;
  if (/以上$/.test(quantity.label)) return language === 'fr' ? `plus de ${quantity.min} ${unit}` : language === 'ar' ? `أكثر من ${quantity.min} ${unit}` : `${quantity.min}+ ${unit}`;
  return `${quantity.min} ${unit}`;
}

/** Lower case without punctuation, symbols and spaces: "only punctuation and spacing differ" compares equal. */
export const normalizeText = (text: string) => text.toLowerCase().normalize('NFKC').replace(/[\p{P}\p{S}\s]+/gu, '');
/** Placeholder lines such as "[图片]" or "[文件] catalog.pdf" stand for attachments, not words. */
export const stripPlaceholders = (text: string) => text.split('\n').filter(line => !/^\[[^\]]*\](\s.*)?$/.test(line.trim())).join('\n');

/**
 * True when the text is the script word for word, apart from punctuation, spacing and what its variables stand
 * for ("原样"). The rules decide this without the AI.
 */
export function matchesExactly(text: string, script: string) {
  const sent = normalizeText(stripPlaceholders(text));
  if (!sent) return false;
  const pieces = script.replace(VARIABLE, '\u0000').split('\u0000').map(piece => normalizeText(piece));
  const escape = (piece: string) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${pieces.map(escape).join('.{0,80}?')}$`, 'u');
  return pattern.test(sent);
}

// ───────────────────────── Grouping ─────────────────────────

export type FlowMessage = {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sentAt: Date;
  content: string;
  messageType: string;
  /** BOS sends carry a request id; phone sends (coexistence echoes, local sync) do not. */
  bos: boolean;
  templateName: string | null;
  senderId: string | null;
};
export type MessageGroup = { key: string; direction: 'INBOUND' | 'OUTBOUND'; at: Date; messages: FlowMessage[] };

/**
 * Messages sent one after another within `minutes` of the first are one group (one touch, or one reply judged once):
 * text, photos, PDFs and videos together. A message from the other side ends the group.
 */
export function groupMessages(messages: FlowMessage[], minutes: number): MessageGroup[] {
  const ordered = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime() || a.id.localeCompare(b.id));
  const groups: MessageGroup[] = [];
  for (const message of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.direction === message.direction && message.sentAt.getTime() - last.at.getTime() <= minutes * 60_000) last.messages.push(message);
    else groups.push({ key: message.id, direction: message.direction, at: message.sentAt, messages: [message] });
  }
  return groups;
}
export const groupText = (group: MessageGroup) => group.messages.map(m => m.content.trim()).filter(Boolean).join('\n');
const MEDIA = new Set(['IMAGE', 'AUDIO', 'VOICE', 'VIDEO', 'STICKER']);
/** Photos and voice notes need a person: the system does not transcribe them. */
export const groupHasMedia = (group: MessageGroup) => group.messages.some(m => MEDIA.has(m.messageType.toUpperCase()));
export const groupHasWords = (group: MessageGroup) => !!normalizeText(stripPlaceholders(groupText(group)));
export function groupChannel(group: MessageGroup): Channel {
  if (group.messages.some(m => m.bos && m.messageType.toUpperCase() === 'TEMPLATE')) return 'BOS_TEMPLATE';
  return group.messages.some(m => m.bos) ? 'BOS_FREE' : 'PHONE';
}

// ───────────────────────── State machine ─────────────────────────

/** What the system knows about one customer reply group: its quality and whether it asks us to stop. */
export type ReplyVerdict = { quality: Quality; stop: boolean };
export type DerivedTouch = {
  key: string; kind: 'ICEBREAK' | 'REVIVE'; code: Position; cycle: number; at: Date;
  windowOpen: boolean; tooSoon: boolean;
  replyKey: string | null; repliedAt: Date | null; replied24h: boolean | null; lateReply: boolean;
};
export type Derivation = {
  state: OutreachState;
  /** Next touch to send (T0–T4 / R1–R3), '' when none is due. */
  next: Position | '';
  cycle: number;
  /** When the next touch is planned (follow-up rhythm), null when there is none. */
  nextTouchAt: Date | null;
  /** The next moment time alone changes something (state timers, a touch reaching 24 hours). */
  dueAt: Date | null;
  touches: DerivedTouch[];
  /** Reply group key → the touch it counts for. */
  replyTouch: Map<string, string>;
  /** The touch the customer first answered. */
  firstAnsweredTouch: string | null;
  bestQuality: Quality | '';
  lastTouchAt: Date | null;
  /** Template messages since the customer's last real reply (all of them when the customer never replied). */
  templatesSinceReply: number;
};

const MAX_ICEBREAK = 5, MAX_REVIVE = 3;

/**
 * Walks a customer's message groups in time order and decides, group by group, what each outbound group is (T0–T4
 * while breaking the ice, R1–R3 while the customer is silent, nothing in a conversation) and which touch a reply
 * belongs to (the last one sent before it). Time moves the state too: 72 hours after the customer's last real
 * message a conversation goes silent; 7 days after T4 or R3 without an answer the lead goes dormant. An auto-reply
 * (INVALID) changes nothing; a request to stop ends all outreach. A customer who wrote first is still being broken
 * the ice with until they answer our first message, so every customer we have not written to gets a T0.
 */
export function deriveOutreach(groups: MessageGroup[], verdict: (key: string) => ReplyVerdict | null, config: OutreachConfig, now: Date): Derivation {
  const silentMs = config.silentHours * HOUR, dormantMs = config.dormantDays * DAY, gapMs = config.minTouchGapHours * HOUR;
  let state: OutreachState = 'ICEBREAK';
  let icebreaks = 0, revives = 0, cycle = 0;
  let firstTouchAt: Date | null = null, silentSince: Date | null = null;
  let episodeTouch: DerivedTouch | null = null;
  let lastTouchAt: Date | null = null, lastInboundAt: Date | null = null, lastRealReplyAt: Date | null = null;
  let firstAnsweredTouch: string | null = null, bestQuality: Quality | '' = '';
  let templatesSinceReply = 0;
  const touches: DerivedTouch[] = [];
  const replyTouch = new Map<string, string>();

  /** The state once time has moved on to `to`; entering a silence starts a new round of R1–R3. */
  const advance = (to: Date): OutreachState => {
    let next = state;
    if (next === 'ICEBREAK' && icebreaks >= MAX_ICEBREAK && lastTouchAt && to.getTime() >= lastTouchAt.getTime() + dormantMs) next = 'DORMANT';
    if (next === 'CONVERSING' && lastRealReplyAt && to.getTime() >= lastRealReplyAt.getTime() + silentMs) {
      next = 'SILENT'; cycle++; revives = 0; episodeTouch = null; silentSince = new Date(lastRealReplyAt.getTime() + silentMs);
    }
    if (next === 'SILENT' && revives >= MAX_REVIVE && lastTouchAt && to.getTime() >= lastTouchAt.getTime() + dormantMs) next = 'DORMANT';
    return next;
  };
  const answer = (group: MessageGroup) => {
    const touch = episodeTouch as DerivedTouch | null;
    if (!touch || touch.replyKey) return;
    touch.replyKey = group.key; touch.repliedAt = group.at;
    touch.replied24h = group.at.getTime() - touch.at.getTime() <= DAY; touch.lateReply = !touch.replied24h;
    replyTouch.set(group.key, touch.key);
    firstAnsweredTouch ??= touch.key;
  };

  for (const group of groups) {
    state = advance(group.at);
    if (group.direction === 'OUTBOUND') {
      templatesSinceReply += group.messages.filter(m => m.messageType.toUpperCase() === 'TEMPLATE').length;
      let code: Position | null = null, kind: DerivedTouch['kind'] = 'ICEBREAK';
      if (state === 'ICEBREAK' && icebreaks < MAX_ICEBREAK) code = `T${icebreaks++}` as Position;
      else if (state === 'SILENT' && revives < MAX_REVIVE) { code = `R${++revives}` as Position; kind = 'REVIVE'; }
      if (!code) continue;
      const touch: DerivedTouch = { key: group.key, kind, code, cycle: kind === 'ICEBREAK' ? 0 : cycle, at: group.at,
        windowOpen: !!lastInboundAt && group.at.getTime() - lastInboundAt.getTime() < DAY,
        tooSoon: !!lastTouchAt && group.at.getTime() - lastTouchAt.getTime() < gapMs,
        replyKey: null, repliedAt: null, replied24h: null, lateReply: false };
      touches.push(touch);
      if (code === 'T0') firstTouchAt = group.at;
      episodeTouch = touch; lastTouchAt = group.at;
      continue;
    }
    lastInboundAt = group.at;
    const judged = verdict(group.key);
    if (!judged || judged.quality === 'INVALID') continue;
    if (!bestQuality || QUALITY_RANK[judged.quality] > QUALITY_RANK[bestQuality]) bestQuality = judged.quality;
    lastRealReplyAt = group.at; templatesSinceReply = 0;
    if (state === 'STOPPED') continue;
    // The reply that ends breaking the ice (or a silence) belongs to the last touch sent before it; a dormant lead
    // writing back answers that touch late.
    if (state !== 'CONVERSING') answer(group);
    if (judged.stop) state = 'STOPPED';
    else if (state === 'ICEBREAK' && judged.quality === 'REJECT') state = 'DORMANT';
    // A customer who writes before we ever did has answered nothing yet: our first message is still T0, and the ice
    // is broken by a reply to it.
    else if (state === 'ICEBREAK' && !touches.length) continue;
    else state = 'CONVERSING';
    if (state !== 'DORMANT') episodeTouch = null;
  }
  state = advance(now);

  for (const touch of touches) if (!touch.replyKey) touch.replied24h = now.getTime() - touch.at.getTime() >= DAY ? false : null;

  const next: Position | '' = state === 'ICEBREAK' && icebreaks < MAX_ICEBREAK ? `T${icebreaks}` as Position
    : state === 'SILENT' && revives < MAX_REVIVE ? `R${revives + 1}` as Position : '';
  let nextTouchAt: Date | null = null;
  if (next && next !== 'T0' && next.startsWith('T') && firstTouchAt) nextTouchAt = new Date((firstTouchAt as Date).getTime() + config.followUpDays[icebreaks - 1] * DAY);
  if (next.startsWith('R') && silentSince) nextTouchAt = new Date((silentSince as Date).getTime() + config.reviveDays[revives] * DAY);
  // A follow-up never comes sooner than the minimum gap after the previous touch.
  if (nextTouchAt && lastTouchAt && nextTouchAt.getTime() < (lastTouchAt as Date).getTime() + gapMs) nextTouchAt = new Date((lastTouchAt as Date).getTime() + gapMs);

  const timers: number[] = [];
  if (state === 'ICEBREAK' && icebreaks >= MAX_ICEBREAK && lastTouchAt) timers.push((lastTouchAt as Date).getTime() + dormantMs);
  if (state === 'CONVERSING' && lastRealReplyAt) timers.push((lastRealReplyAt as Date).getTime() + silentMs);
  if (state === 'SILENT' && revives >= MAX_REVIVE && lastTouchAt) timers.push((lastTouchAt as Date).getTime() + dormantMs);
  for (const touch of touches) if (touch.replied24h === null) timers.push(touch.at.getTime() + DAY);
  const future = timers.filter(t => t > now.getTime());

  return { state, next, cycle: next.startsWith('R') ? cycle : 0, nextTouchAt, dueAt: future.length ? new Date(Math.min(...future)) : null,
    touches, replyTouch, firstAnsweredTouch, bestQuality, lastTouchAt, templatesSinceReply };
}

// ───────────────────────── Reply rules ─────────────────────────

const AUTO_REPLY = /thank(s| you) for (contacting|your message|reaching|writing)|we (will|'ll) (get back|reply|respond|contact you)|(will|'ll) (get back|reply|respond) (to you )?(as soon as|shortly|soon)|currently (unavailable|away|closed|out of)|out of (the )?office|away from (the|my) (phone|office)|automatic (reply|message)|auto-?reply|business hours|merci (de|pour) votre (message|contact)|nous vous r[ée]pondrons|gracias por (su|tu) mensaje|le responderemos|شكرا لتواصلك|سنرد عليك|感谢您的(来信|留言|联系)|我们会尽快(回复|联系)|自动回复/i;
// Whole-message stop requests only (like the webhook's opt-out); anything subtler is left to the AI.
const STOP = /^(please\s+)?(stop|unsubscribe|remove me|do not (contact|message) me( again)?|don'?t (contact|message|text) me( again)?|stop (messaging|texting|contacting) me|arr[eê]tez|ne me contactez plus|no me contactes?( m[aá]s)?|لا تراسلني|不要(再)?联系(我)?|请勿联系|停止联系|退订)[.!。！\s]*$/i;
const BUYING = /price|prix|precio|سعر|多少钱|价格|报价|moq|minimum order|起订|quantity|quantit|cantidad|\b\d{2,}\s?(pcs|pieces|units|sets|sofas?)\b|shipping|freight|delivery time|lead time|livraison|envío|شحن|运费|交期|sample|échantillon|muestra|عينة|样品|visit (your )?factory|visiter|visitar|看厂|验厂/i;
const POLITE = /^((ok(ay)?|thanks?|thank you|merci|gracias|شكرا|好的|谢谢|收到|noted|sure|d'accord|vale|i'?ll check|will check|later|👍|🙏|👌|🙂|😊)[\s.!,。！，]*)+$/iu;
const NO = /not interested|no thanks|pas int[ée]ress|no me interesa|غير مهتم|不需要|不感兴趣|already have (a )?supplier|wrong number|mauvais num/i;

/**
 * The rule verdict, given at once while the AI is pending or when it is not configured: auto-replies, stop
 * requests, plain buying words, polite one-liners and refusals are clear from the words; the rest is an
 * engagement until the AI reads it. Photos and voice notes without words need a person.
 */
export function ruleReply(text: string, hasMedia: boolean, hasWords: boolean): { quality: Quality; signals: string[]; reason: string } {
  const plain = stripPlaceholders(text).trim();
  if (!hasWords) return { quality: 'ENGAGED', signals: hasMedia ? ['NEEDS_HUMAN'] : [], reason: hasMedia ? '只有图片或语音，没有文字，需要人工查看' : '没有文字内容' };
  if (STOP.test(plain)) return { quality: 'REJECT', signals: ['STOP_CONTACT'], reason: '客户要求停止联系' };
  if (AUTO_REPLY.test(plain) && !BUYING.test(plain)) return { quality: 'INVALID', signals: [], reason: '像是对方账号的自动回复' };
  if (NO.test(plain)) return { quality: 'REJECT', signals: /supplier|供应商/i.test(plain) ? ['HAS_SUPPLIER'] : [], reason: '客户明确表示不需要' };
  if (BUYING.test(plain)) return { quality: 'HIGH', signals: [], reason: '出现采购相关字眼' };
  if (POLITE.test(plain)) return { quality: 'LOW', signals: [], reason: '只有礼貌回应' };
  return { quality: 'ENGAGED', signals: hasMedia ? ['NEEDS_HUMAN'] : [], reason: '有实际内容，等待 AI 细判' };
}

// ───────────────────────── Win probability ─────────────────────────

/** Deterministic PRNG (mulberry32): the same data always gives the same probability on every page load. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(next: () => number) {
  const u = 1 - next(), v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
/** Marsaglia–Tsang gamma sampler, shape ≥ 1 (Beta(replies + 1, misses + 1) always is). */
function gamma(shape: number, next: () => number): number {
  if (shape < 1) return gamma(shape + 1, next) * Math.pow(next(), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { x = normal(next); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = next();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * For each script, the share of 10,000 draws from Beta(replies + 1, non-replies + 1) in which it comes first. With
 * few sends this is steadier than comparing reply rates directly.
 */
export function winProbabilities(arms: { replied: number; sent: number }[], draws = 10_000, seed = 20261021): number[] {
  if (!arms.length) return [];
  const next = random(seed);
  const wins = arms.map(() => 0);
  for (let i = 0; i < draws; i++) {
    let best = -1, bestValue = -1;
    arms.forEach((arm, index) => {
      const x = gamma(arm.replied + 1, next), y = gamma(arm.sent - arm.replied + 1, next);
      const value = x / (x + y);
      if (value > bestValue) { bestValue = value; best = index; }
    });
    wins[best]++;
  }
  return wins.map(w => w / draws);
}

export const SUGGESTIONS = { INSUFFICIENT: '数据不足，继续轮换', CONTINUE: '继续测试', WIN: '建议胜出', RETIRE: '建议停用' } as const;
export type Suggestion = keyof typeof SUGGESTIONS;
export type ArmResult = { probability: number | null; suggestion: Suggestion };
/**
 * Scripts below the sample threshold are not compared ("数据不足"). Among those above it (two at least), ≥ 90% is
 * "建议胜出" and < 10% "建议停用"; operations confirm before a status changes, the system never changes it itself.
 */
export function judgeArms(arms: { replied: number; sent: number }[], config: Pick<OutreachConfig, 'minSample' | 'winProbability' | 'loseProbability'>): ArmResult[] {
  const qualified = arms.map((arm, index) => ({ arm, index })).filter(({ arm }) => arm.sent >= config.minSample);
  const results: ArmResult[] = arms.map(arm => ({ probability: null, suggestion: arm.sent >= config.minSample ? 'CONTINUE' : 'INSUFFICIENT' }));
  if (qualified.length < 2) return results;
  const probabilities = winProbabilities(qualified.map(q => q.arm));
  qualified.forEach(({ index }, i) => {
    const p = probabilities[i];
    results[index] = { probability: p, suggestion: p >= config.winProbability ? 'WIN' : p < config.loseProbability ? 'RETIRE' : 'CONTINUE' };
  });
  return results;
}

/** Percentage with one decimal, or null when there is nothing to divide by (shown as "—"). */
export const percent = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 10 : null;

// ───────────────────────── Focus signals ─────────────────────────

export type Rate = { sent: number; replied: number };
export type SignalInput = {
  /** T0 touches that reached 24 hours in the last 7 days, and in each of the 4 weeks before. */
  t0Current: Rate; t0Previous: Rate[];
  /** Graded form leads (A/B/C) in the last 7 days and the 4 weeks before; business = A or B. */
  leadsCurrent: { total: number; business: number }; leadsPrevious: { total: number; business: number }[];
  hotBacklog: number;
  staleQuotes: number;
  slowFirstReplies: number;
  nonStandard: { name: string; share: number; total: number }[];
  /** Items completed this week by category. */
  energy: Record<Category, number>;
};
export type FocusSignal = { key: string; title: string; detail: string; focus: string; category: Category; href: string };

const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
/**
 * Where the focus should move, from BOS data. Each signal compares against the customer's own last four weeks rather
 * than a fixed number, so a low reply rate today does not keep the light on forever. A signal disappears as soon as
 * its condition no longer holds.
 */
export function focusSignals(input: SignalInput, config: OutreachConfig): FocusSignal[] {
  const signals: FocusSignal[] = [];
  const nowRate = input.t0Current.sent >= config.replyRateMinSample ? input.t0Current.replied / input.t0Current.sent * 100 : null;
  const before = average(input.t0Previous.filter(w => w.sent > 0).map(w => w.replied / w.sent * 100));
  if (nowRate !== null && before !== null && before - nowRate >= config.replyRateDropPoints) signals.push({ key: 'reply-rate', category: 'DATA', href: '/outreach',
    title: '回复率下滑', focus: '话术：本周优先改首回话术',
    detail: `近 7 天 T0 的 24 小时回复率 ${nowRate.toFixed(1)}%，比前 4 周平均 ${before.toFixed(1)}% 低 ${(before - nowRate).toFixed(1)} 个百分点（${input.t0Current.sent} 条）` });
  const share = input.leadsCurrent.total ? input.leadsCurrent.business / input.leadsCurrent.total * 100 : null;
  const shareBefore = average(input.leadsPrevious.filter(w => w.total > 0).map(w => w.business / w.total * 100));
  if (share !== null && shareBefore !== null && shareBefore - share >= config.businessShareDropPoints) signals.push({ key: 'lead-quality', category: 'FRONTEND', href: '/analytics/ads',
    title: '线索质量下滑', focus: '前端：检查广告受众和表单',
    detail: `近 7 天企业线索占比 ${share.toFixed(1)}%，比前 4 周平均 ${shareBefore.toFixed(1)}% 低 ${(shareBefore - share).toFixed(1)} 个百分点` });
  if (input.hotBacklog > 0) signals.push({ key: 'hot-backlog', category: 'CONVERT', href: '/outreach/review?tab=hot',
    title: '高意向积压', focus: '转化：今天先处理这些客户', detail: `${input.hotBacklog} 位客户的高意向回复超过 ${config.hotBacklogHours} 小时没推进到报价` });
  if (input.staleQuotes >= config.staleQuoteCount) signals.push({ key: 'stale-quotes', category: 'CONVERT', href: '/sales',
    title: '报价停滞', focus: '转化：安排报价后跟进', detail: `${input.staleQuotes} 位客户报价后 ${config.staleQuoteDays} 天没有进展` });
  if (input.slowFirstReplies >= config.slowFirstReplyCount) signals.push({ key: 'slow-first-reply', category: 'CONVERT', href: '/messages?filter=pending',
    title: '响应变慢', focus: '流程：检查值班和分配', detail: `今天有 ${input.slowFirstReplies} 条新线索首回超过 ${config.firstReplyMinutes} 分钟` });
  for (const person of input.nonStandard.filter(p => p.total >= config.nonStandardMinTouches && p.share > config.nonStandardShare)) signals.push({ key: `non-standard:${person.name}`, category: 'DATA', href: '/outreach',
    title: '非标准话术偏多', focus: '管理：和业务员对一遍话术', detail: `${person.name} 近 7 天非标准话术占 ${(person.share * 100).toFixed(0)}%（${person.total} 次触达）` });
  const done = input.energy.CONVERT + input.energy.FRONTEND + input.energy.DATA;
  if (done >= config.energyMinItems) {
    for (const category of keys(CATEGORIES)) {
      const actual = input.energy[category] / done * 100, target = config.energyTargets[category];
      if (Math.abs(actual - target) > config.energyDeviationPoints) signals.push({ key: `energy:${category}`, category, href: '/workbench/history',
        title: '精力分配偏离', focus: `精力：${CATEGORIES[category]}${actual > target ? '偏多' : '偏少'}，回到 ${config.energyTargets.CONVERT} / ${config.energyTargets.FRONTEND} / ${config.energyTargets.DATA}`,
        detail: `本周已完成事项中${CATEGORIES[category]}占 ${actual.toFixed(0)}%，目标 ${target}%` });
    }
  }
  return signals;
}
