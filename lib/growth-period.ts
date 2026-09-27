import { z } from 'zod';
import { dayKey,localDate } from './time';
import { HttpError } from './auth';

const iso=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value,'日期无效');
export const growthPeriodQuery=z.object({range:z.enum(['today','yesterday','7d','30d','90d','custom']).default('30d'),startDate:iso.optional(),endDate:iso.optional()});
export function growthPeriod(input:unknown,now:Date,timezone:string){
 const query=growthPeriodQuery.parse(input);const today=dayKey(now,timezone);
 const shift=(date:string,days:number)=>{const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);};
 const startDate=query.range==='custom'&&query.startDate?query.startDate:shift(today,query.range==='yesterday'?-1:query.range==='7d'?-6:query.range==='90d'?-89:query.range==='today'?0:-29);
 const endDate=query.range==='custom'&&query.endDate?query.endDate:query.range==='yesterday'?shift(today,-1):today;
 if(startDate>endDate||new Date(`${endDate}T12:00:00Z`).getTime()-new Date(`${startDate}T12:00:00Z`).getTime()>366*86400000)throw new HttpError(400,'请选择不超过 366 天的有效日期范围');
 return {...query,startDate,endDate,start:localDate(`${startDate}T00:00`,timezone),end:localDate(`${shift(endDate,1)}T00:00`,timezone),metricStart:new Date(`${startDate}T00:00:00Z`),metricEnd:new Date(`${shift(endDate,1)}T00:00:00Z`)};
}
