/**
 * 每日一签 (docs/IDEA_WALL.md §每日一签): a morning ritual on the work calendar. Ask about one thing, draw one sign a
 * day; only good signs exist. The poems are original. What the sign says about work (宜 / 忌, 吉时, 贵人方位) comes
 * from the day's real data, and in the evening the day's data says whether it came true. All rules here are pure.
 */
export const SIGN_TOPICS = { DEAL: ['💰', '成交'], CLIENT: ['🤝', '客户'], ADS: ['📣', '广告'], IDEA: ['💡', '灵感'], MOOD: ['🌿', '心情'] } as const;
export type SignTopic = keyof typeof SIGN_TOPICS;
export const isSignTopic = (v: string): v is SignTopic => Object.prototype.hasOwnProperty.call(SIGN_TOPICS, v);
export type Grade = '大吉' | '中吉' | '吉';

type Sign = { no: number; grade: Grade; poem: [string, string, string, string]; read: string };
/** Three signs per question; which one comes depends on the person and the day. */
export const SIGNS: Record<SignTopic, Sign[]> = {
  DEAL: [
    { no: 38, grade: '大吉', poem: ['东风一夜到船头', '千帆待发不须愁', '若问良缘何处是', '{dir}云开见远舟'], read: '东风已到，船靠岸只差一步。今天适合推一把已经报过价的客户。' },
    { no: 52, grade: '中吉', poem: ['春耕秋获自有时', '枝头青果未曾迟', '但将清水勤浇灌', '满树金黄在后期'], read: '果子已经结了，只是还没熟。别急着降价催单，把客户关心的交期、包装一一答清楚，熟了自然落袋。' },
    { no: 76, grade: '吉', poem: ['一纸书来过海涯', '千言不及一句话', '若能直问君何意', '不必空猜到日斜'], read: '与其反复猜客户在想什么，不如直接问一句「您还在比较哪几家？」。今天适合把话说透。' },
  ],
  CLIENT: [
    { no: 12, grade: '中吉', poem: ['门前初见客三人', '一盏清茶话语真', '莫嫌来者言犹少', '久处方知是故人'], read: '今天会来新客人，话不多别着急。多问一句「要什么尺寸、多少件」，比多发一份目录管用。' },
    { no: 5, grade: '大吉', poem: ['晨光初照有人来', '早启柴门笑脸开', '先到先知先结识', '迟来只见落花苔'], read: '先回的人先结识。夜里进线的客户，上班第一件事就回。' },
    { no: 61, grade: '吉', poem: ['旧友多年未问安', '一书寄去暖冬寒', '莫言往事随风散', '故纸翻开又见欢'], read: '今天适合问候一位很久没联系的老客户，问问最近卖得怎么样。生意常常从一句问候开始。' },
  ],
  ADS: [
    { no: 21, grade: '吉', poem: ['春雨无声润万家', '一枝先发是新芽', '且将力气投高处', '莫在荒田种落花'], read: '钱要浇在已经冒芽的地方：便宜的素材、回复多的时段。一直不出线索的那块田，今天先别再撒钱。' },
    { no: 44, grade: '中吉', poem: ['两岸青山各有花', '东边红艳西边霞', '若知何处蜂来早', '便把甘泉引向它'], read: 'Facebook 和 Instagram 各有各的客人，看看哪边每个有效客户更便宜，把预算往那边挪一点。' },
    { no: 89, grade: '大吉', poem: ['良弓不射远天鹰', '先看林间雀几层', '射准一枝千鸟落', '何须满弦尽空腾'], read: '别把广告撒向所有人。盯准最像成交客户的那一群——国家、时段、素材——一箭比十箭管用。' },
  ],
  IDEA: [
    { no: 7, grade: '中吉', poem: ['夜半灯前忽有思', '一行小字记心知', '今朝若肯翻墙看', '旧纸也开新一枝'], read: '今天翻一翻想法墙，放了很久的那张纸条，也许正是时候。' },
    { no: 33, grade: '吉', poem: ['山中泉水自东流', '不见源头不必愁', '随手拾来三两句', '他年或可作行舟'], read: '想到了就记下来，不用想清楚。今天至少往墙上贴一张。' },
    { no: 67, grade: '大吉', poem: ['一灯点亮万灯明', '小念生根大事成', '莫笑今朝纸上字', '明朝也许满城声'], read: '今天适合把一张「想做」的纸条转成任务。小念头做起来，常常比想象中有用。' },
  ],
  MOOD: [
    { no: 1, grade: '大吉', poem: ['风过竹林自有声', '不随云雨乱阴晴', '一壶慢煮人间事', '步步从容步步成'], read: '今天不必赶。一件一件来，慢反而快。客户回得慢也别慌，他们那边可能还没醒。' },
    { no: 18, grade: '中吉', poem: ['云开雾散见晴川', '昨日风波已过船', '且把心思收一处', '眼前一事最当先'], read: '昨天的事翻篇了。今天只盯眼前最要紧的一件，做完再看下一件。' },
    { no: 90, grade: '吉', poem: ['庭前花落又花开', '得失从容莫挂怀', '若问今朝心境好', '推窗先放好风来'], read: '成交不成交都别挂在心上。中午出去走十分钟，回来再接着干。' },
  ],
};

/** A small stable hash: the same person, day and question always give the same sign. */
export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 1–99 in Chinese numerals: 38 → 三十八, 10 → 十, 5 → 五. */
export function cnNumber(n: number) {
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10), ones = n % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${ones ? DIGITS[ones] : ''}`;
}

/** Where a country lies seen from China, as 贵人方位 says it. Countries not listed fall back to 西. */
const DIRECTIONS: Record<string, string> = {
  FR: '西北', BE: '西北', LU: '西北', CH: '西北', DE: '西北', NL: '西北', GB: '西北', IE: '西北', ES: '西北', PT: '西北', IT: '西北', PL: '西北', RU: '西北',
  MA: '西', DZ: '西', TN: '西', LY: '西', EG: '西', SA: '西', AE: '西', QA: '西', KW: '西', JO: '西', LB: '西', TR: '西', SN: '西', MR: '西', ML: '西',
  CI: '西南', GH: '西南', NG: '西南', CM: '西南', GA: '西南', CG: '西南', CD: '西南', KE: '西南', TZ: '西南', ZA: '西南', MG: '西南', RE: '西南', MU: '西南', IN: '西南',
  US: '东', CA: '东北', MX: '东', BR: '东南', AR: '东南', CL: '东南', AU: '南', NZ: '东南', JP: '东', KR: '东', SG: '南', MY: '南', TH: '南', VN: '南', ID: '南', PH: '东南',
};
export const directionOf = (countryCode: string) => DIRECTIONS[countryCode.toUpperCase()] ?? '西';

const COLORS = ['墨绿', '朱红', '金黄', '天蓝', '米白', '藏青', '橙色', '浅紫'];
const LUCK = ['综合运', '成交运', '客户运', '广告运', '灵感运'] as const;
const TOPIC_LUCK: Record<SignTopic, number> = { DEAL: 1, CLIENT: 2, ADS: 3, IDEA: 4, MOOD: 0 };

export type Facts = {
  /** The main market (most effective customers lately), its code and the best sending hours in company time. */
  country: string; countryCode: string; luckyHours: string | null;
  staleQuote: { name: string; days: number } | null;
  nightLeads: number; pendingSuggestions: number; costlyAd: string | null;
  oldIdea: { text: string; days: number } | null;
};
export type Gift = { text: string; source: string };

/** Draws today's sign for a question. Pure: everything that varies comes in through the arguments. */
export function drawSign(userId: string, day: string, topic: SignTopic, facts: Facts, gift: Gift) {
  const seed = hash(`${userId}|${day}|${topic}`);
  const sign = SIGNS[topic][seed % SIGNS[topic].length];
  const dir = directionOf(facts.countryCode);
  const top = sign.grade === '大吉' ? 5 : 4;
  const stars = LUCK.map((label, i) => ({ label, stars: i === TOPIC_LUCK[topic] ? top : 3 + ((seed >>> (i * 3)) % 3) }));
  stars[0].stars = Math.max(stars[0].stars, top === 5 ? 5 : 4);
  const { yi, ji } = advice(topic, facts);
  return {
    topic, no: sign.no, noText: cnNumber(sign.no), grade: sign.grade,
    poem: sign.poem.map(line => line.replace('{dir}', dir)),
    read: `${sign.read}${topic === 'DEAL' || topic === 'CLIENT' ? `贵人在${dir}${facts.country ? `，往${facts.country}那边多看一眼` : ''}。` : ''}`,
    stars,
    charms: { color: COLORS[seed % COLORS.length], number: 1 + (seed % 9), hours: facts.luckyHours ?? '10:00–12:00', direction: dir },
    yi, ji, gift,
  };
}
export type SignContent = ReturnType<typeof drawSign>;

/** 宜 / 忌 for the question, from the day's data; general advice where the data has nothing to say. */
export function advice(topic: SignTopic, f: Facts) {
  const hours = f.luckyHours ? `${f.luckyHours} 给${f.country || '主要市场的'}客户发消息` : '上午先把要回的消息回完';
  switch (topic) {
    case 'DEAL': return {
      yi: [f.staleQuote ? `追一下 ${f.staleQuote.name}：报价发出 ${f.staleQuote.days} 天还没回` : '追一位报过价、还没回的客户', hours],
      ji: ['急着降价', '同一位客户追到第 4 次还不停'] };
    case 'CLIENT': return {
      yi: [f.nightLeads ? `上班先回夜里进线的 ${f.nightLeads} 位 A / B` : '新客户进来，先回他', '第一句先问尺寸和数量'],
      ji: ['一上来就发整本目录'] };
    case 'ADS': return {
      yi: [f.pendingSuggestions ? `看一眼 AI 计划里的 ${f.pendingSuggestions} 条广告建议` : '看一眼国家作战卡的素材排名', '把钱往每个有效客户更便宜的地方挪'],
      ji: [f.costlyAd ? `给「${f.costlyAd}」加预算` : '一天之内反复改广告'] };
    case 'IDEA': return {
      yi: [f.oldIdea ? `翻出「${f.oldIdea.text.slice(0, 16)}」：贴了 ${f.oldIdea.days} 天` : '往想法墙上贴一张新纸条', '随手记下新冒出来的念头'],
      ji: ['想到了不记'] };
    default: return { yi: ['按时间线一件一件做', '中午出去走十分钟'], ji: ['一直刷新等回复'] };
  }
}

/** Days in a row with a sign, ending today (or yesterday, before today's is drawn). */
export function streak(days: string[], today: string) {
  const have = new Set(days);
  const step = (key: string) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  let at = have.has(today) ? today : step(today), n = 0;
  while (have.has(at)) { n++; at = step(at); }
  return n;
}

/** 周签: the week's signs in one line, once there are a few. */
export function weekLine(signs: { topic: string; grade: string; verdict: string }[]) {
  if (signs.length < 3) return '';
  const asked = new Map<string, number>();
  for (const s of signs) asked.set(s.topic, (asked.get(s.topic) ?? 0) + 1);
  const most = [...asked].sort((a, b) => b[1] - a[1])[0];
  const name = SIGN_TOPICS[most[0] as SignTopic]?.[1] ?? most[0];
  const came = signs.filter(s => s.verdict === 'YES').length;
  const big = signs.filter(s => s.grade === '大吉').length;
  return `这周求了 ${signs.length} 签，问得最多的是「${name}」（${most[1]} 次）；${big ? `抽到 ${big} 次大吉，` : ''}应验 ${came} 次。${came >= signs.length / 2 ? '手气正旺，接着干。' : '签只是开个头，事还得一件件做。'}`;
}
