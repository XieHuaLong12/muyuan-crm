import { formatInTimeZone } from 'date-fns-tz';
import { localDate } from './time';

/** Actual inquiry time; legacy/imported records fall back without changing attribution. */
export function inquiryDate<T extends Date|string>(c:{inquiryAt?:T|null;createdAt:T}):T {
  return c.inquiryAt ?? c.createdAt;
}

export function isBusinessDate(value:string):boolean {
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if(!match)return false;
  const [,year,month,day,hour='00',minute='00',second='00',offset]=match;
  const d=new Date(Date.UTC(+year,+month-1,+day));
  if(+year<1900||d.getUTCFullYear()!==+year||d.getUTCMonth()!==+month-1||d.getUTCDate()!==+day||+hour>23||+minute>59||+second>59)return false;
  if(offset&&offset!=='Z'){const [h,m]=offset.slice(1).split(':').map(Number);if(h>14||m>59||h===14&&m!==0)return false;}
  return true;
}

export function parseInquiryDate(value:string,tz:string,now=new Date()):Date {
  if(!isBusinessDate(value))throw new Error('询盘日期不合法，请选择真实的日期和时间');
  const d=localDate(value,tz);
  if(!Number.isFinite(d.getTime()))throw new Error('询盘日期不合法');
  if(!/Z$|[+-]\d{2}:\d{2}$/.test(value)){
    const expected=value.length===10?`${value}T00:00`:value.slice(0,16);
    if(formatInTimeZone(d,tz,"yyyy-MM-dd'T'HH:mm")!==expected)throw new Error('该时间在当前时区不存在，请重新选择');
  }
  if(d>now)throw new Error('询盘日期不能晚于当前时间');
  return d;
}
