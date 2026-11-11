/**
 * Number and time formatting. Rules from docs/mobile-app/DESIGN_SYSTEM.md:
 * currency symbol + thousands separators; 万 only in overviews; unknown values show 「—」; no currency conversion.
 */
export class DueLabel {
  text: string = '';
  late: boolean = false;
  soon: boolean = false;
}

const MINUTE = 60000;
const DAY = 86400000;

export class Fmt {
  static pad(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
  }

  /** 1286450.5 → "1,286,450.5"; digits = decimals kept (trailing zeros removed). */
  static group(value: number, digits: number = 2): string {
    if (!isFinite(value)) return '—';
    const fixed = value.toFixed(digits);
    const parts = fixed.split('.');
    const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const decimals = parts.length > 1 ? parts[1].replace(/0+$/, '') : '';
    return decimals.length > 0 ? `${whole}.${decimals}` : whole;
  }

  static symbol(currency: string): string {
    if (currency === 'CNY') return '¥';
    if (currency === 'USD') return 'US$ ';
    if (currency === 'EUR') return '€';
    return `${currency} `;
  }

  /** Prisma Decimal values arrive as strings ("168000.00"). */
  static money(amount: string | number | null | undefined, currency: string = 'CNY'): string {
    if (amount === null || amount === undefined || amount === '') return '—';
    const n = typeof amount === 'number' ? amount : Number(amount);
    if (isNaN(n)) return '—';
    return `${Fmt.symbol(currency)}${Fmt.group(n)}`;
  }

  /** 1286450 → "128.6万" for overview figures. */
  static wan(n: number): string {
    if (n < 10000) return Fmt.group(n, 0);
    return `${(n / 10000).toFixed(n >= 1000000 ? 1 : 2).replace(/\.?0+$/, '')}万`;
  }

  static parse(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  static time(d: Date): string {
    return `${Fmt.pad(d.getHours())}:${Fmt.pad(d.getMinutes())}`;
  }

  static date(d: Date): string {
    return `${Fmt.pad(d.getMonth() + 1)}-${Fmt.pad(d.getDate())}`;
  }

  /** Whole calendar days from today (0 today, -1 yesterday, 1 tomorrow). */
  static dayDiff(d: Date): number {
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const now = new Date();
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.round((a - b) / DAY);
  }

  /** Feed time: 刚刚 / 12 分钟前 / 今天 09:40 / 昨天 18:00 / 11-07 16:20. */
  static ago(iso: string | null | undefined): string {
    const d = Fmt.parse(iso);
    if (!d) return '—';
    const diff = (Date.now() - d.getTime()) / MINUTE;
    if (diff >= 0 && diff < 1) return '刚刚';
    if (diff >= 0 && diff < 60) return `${Math.round(diff)} 分钟前`;
    const days = Fmt.dayDiff(d);
    if (days === 0) return `今天 ${Fmt.time(d)}`;
    if (days === -1) return `昨天 ${Fmt.time(d)}`;
    return `${Fmt.date(d)} ${Fmt.time(d)}`;
  }

  /** Deadline wording: 逾期 2 小时 / 36 分钟后 / 今天 14:00 / 明天 10:00 / 11-17 10:00. */
  static due(iso: string | null | undefined): DueLabel {
    const result = new DueLabel();
    const d = Fmt.parse(iso);
    if (!d) {
      result.text = '未设置';
      return result;
    }
    const diff = (d.getTime() - Date.now()) / MINUTE;
    if (diff < 0) {
      const late = -diff;
      result.late = true;
      result.text = late < 60 ? `逾期 ${Math.round(late)} 分钟` : late < 1440 ? `逾期 ${Math.round(late / 60)} 小时` : `逾期 ${Math.round(late / 1440)} 天`;
      return result;
    }
    if (diff < 60) {
      result.soon = true;
      result.text = `${Math.max(1, Math.round(diff))} 分钟后`;
      return result;
    }
    const days = Fmt.dayDiff(d);
    result.text = days === 0 ? `今天 ${Fmt.time(d)}` : days === 1 ? `明天 ${Fmt.time(d)}` : `${Fmt.date(d)} ${Fmt.time(d)}`;
    return result;
  }

  static greeting(): string {
    const h = new Date().getHours();
    return h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  }

  static today(): string {
    const d = new Date();
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${'日一二三四五六'.charAt(d.getDay())}`;
  }

  /** Initials for avatars: "Ahmed Al-Harbi" → "AA"; Chinese names → first character. */
  static initials(name: string): string {
    const words = name.trim().split(/\s+/).filter((w: string): boolean => w.length > 0);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }

  /** A future time `days` from today at hour:00, as an ISO string for the API. */
  static atDay(days: number, hour: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }
}
