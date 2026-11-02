/**
 * Public holidays of the main markets, for the country card's 「接下来的节假日」. Fixed dates and the days that
 * follow Easter are exact; Islamic holidays move with the moon and are given as the expected day (约), to be
 * confirmed locally. A country not listed shows none rather than a guess.
 */
type Holiday = { date: string; name: string; note: string; approx?: boolean };

/** Western Easter Sunday (anonymous Gregorian algorithm), as yyyy-mm-dd. */
export function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/** Expected (not announced) dates; the year's local authorities fix the exact day. */
const ISLAMIC: Record<number, { fitr: string; adha: string; mawlid: string; newYear: string }> = {
  2026: { fitr: '2026-03-20', adha: '2026-05-27', newYear: '2026-06-16', mawlid: '2026-08-25' },
  2027: { fitr: '2027-03-10', adha: '2027-05-17', newYear: '2027-06-06', mawlid: '2027-08-15' },
  2028: { fitr: '2028-02-27', adha: '2028-05-05', newYear: '2028-05-25', mawlid: '2028-08-03' },
};

const FIXED: Record<string, [string, string, string][]> = {
  FR: [['01-01', '元旦', '假期后一周询盘回升'], ['05-01', '劳动节', '公共假日'], ['05-08', '二战胜利纪念日', '公共假日，5 月桥假多'], ['07-14', '国庆日', '7 月中开始进入暑假'],
    ['08-15', '圣母升天节', '8 月整月回复慢，适合提前沟通备货'], ['11-01', '诸圣节', '公共假日'], ['11-11', '停战纪念日', '公共假日'], ['12-25', '圣诞节', '12 月 20 日前后很多批发商放假，下单提前到 12 月初']],
  BE: [['01-01', '元旦', '公共假日'], ['05-01', '劳动节', '公共假日'], ['07-21', '国庆日', '公共假日'], ['08-15', '圣母升天节', '8 月回复慢'],
    ['11-01', '诸圣节', '公共假日'], ['11-11', '停战纪念日', '公共假日'], ['12-25', '圣诞节', '年底放假早']],
  MA: [['01-01', '元旦', '公共假日'], ['01-11', '独立宣言纪念日', '公共假日'], ['01-14', '阿马齐格新年', '公共假日'], ['05-01', '劳动节', '公共假日'], ['07-30', '登基日', '公共假日'],
    ['08-14', '黄金谷收复日', '公共假日'], ['08-20', '国王与人民革命日', '公共假日'], ['08-21', '青年节', '公共假日'], ['11-06', '绿色进军纪念日', '公共假日'], ['11-18', '独立日', '公共假日']],
  CI: [['01-01', '元旦', '公共假日'], ['05-01', '劳动节', '公共假日'], ['08-07', '独立日', '公共假日'], ['08-15', '圣母升天节', '公共假日'],
    ['11-01', '诸圣节', '公共假日'], ['11-15', '国家和平日', '公共假日'], ['12-25', '圣诞节', '公共假日']],
  SN: [['01-01', '元旦', '公共假日'], ['04-04', '独立日', '公共假日'], ['05-01', '劳动节', '公共假日'], ['08-15', '圣母升天节', '公共假日'], ['11-01', '诸圣节', '公共假日'], ['12-25', '圣诞节', '公共假日']],
  DZ: [['01-01', '元旦', '公共假日'], ['05-01', '劳动节', '公共假日'], ['07-05', '独立日', '公共假日'], ['11-01', '革命纪念日', '公共假日']],
  TN: [['01-01', '元旦', '公共假日'], ['03-20', '独立日', '公共假日'], ['05-01', '劳动节', '公共假日'], ['07-25', '共和国日', '公共假日'], ['08-13', '妇女节', '公共假日']],
  CM: [['01-01', '元旦', '公共假日'], ['05-01', '劳动节', '公共假日'], ['05-20', '国庆日', '公共假日'], ['08-15', '圣母升天节', '公共假日'], ['12-25', '圣诞节', '公共假日']],
  CH: [['01-01', '元旦', '公共假日'], ['08-01', '国庆日', '公共假日'], ['12-25', '圣诞节', '年底放假早']],
  LU: [['01-01', '元旦', '公共假日'], ['05-01', '劳动节', '公共假日'], ['06-23', '国庆日', '公共假日'], ['12-25', '圣诞节', '公共假日']],
};
/** Days counted from Easter Sunday that are public holidays. */
const EASTER: Record<string, [number, string][]> = {
  FR: [[1, '复活节星期一'], [39, '耶稣升天节'], [50, '圣灵降临节星期一']],
  BE: [[1, '复活节星期一'], [39, '耶稣升天节'], [50, '圣灵降临节星期一']],
  CI: [[1, '复活节星期一'], [39, '耶稣升天节'], [50, '圣灵降临节星期一']],
  SN: [[1, '复活节星期一'], [50, '圣灵降临节星期一']],
  CM: [[-2, '耶稣受难日'], [39, '耶稣升天节']],
  CH: [[-2, '耶稣受难日'], [1, '复活节星期一'], [39, '耶稣升天节']],
  LU: [[1, '复活节星期一'], [39, '耶稣升天节'], [50, '圣灵降临节星期一']],
};
const MUSLIM = new Set(['MA', 'DZ', 'TN', 'SN', 'CI', 'CM', 'EG', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'ML', 'NE', 'MR', 'GN', 'LY']);

function holidaysOf(code: string, year: number): Holiday[] {
  const out: Holiday[] = (FIXED[code] ?? []).map(([md, name, note]) => ({ date: `${year}-${md}`, name, note }));
  const e = easter(year);
  for (const [days, name] of EASTER[code] ?? []) out.push({ date: iso(plus(e, days)), name, note: '公共假日，前后常有桥假' });
  const islamic = ISLAMIC[year];
  if (islamic && MUSLIM.has(code)) {
    out.push({ date: islamic.fitr, name: '开斋节', note: '斋月期间白天回复慢，节前一周很少下单', approx: true });
    out.push({ date: islamic.adha, name: '宰牲节', note: '前后一周基本停工', approx: true });
    if (['MA', 'DZ', 'TN', 'SN', 'CI', 'EG', 'ML', 'NE', 'MR', 'GN', 'LY'].includes(code)) out.push({ date: islamic.mawlid, name: '圣纪节', note: '公共假日', approx: true });
  }
  return out;
}

/** The next holidays of a country from `today` (yyyy-mm-dd), soonest first. */
export function upcomingHolidays(code: string, today: string, limit = 4, withinDays = 150) {
  const year = Number(today.slice(0, 4));
  const until = iso(plus(new Date(`${today}T00:00:00Z`), withinDays));
  return [...holidaysOf(code, year), ...holidaysOf(code, year + 1)]
    .filter(h => h.date >= today && h.date <= until).sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit)
    .map(h => ({ ...h, label: `${Number(h.date.slice(5, 7))}/${Number(h.date.slice(8, 10))}${h.approx ? ' 约' : ''}` }));
}
export const hasHolidays = (code: string) => !!FIXED[code];
