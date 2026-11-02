import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { pagedGraphGet } from '@/lib/meta-graph';
import { leadCountFromActions } from './meta-ads-service';

const adSchema = z.object({ id: z.string(), name: z.string().default(''), adset_id: z.string(), campaign_id: z.string(),
  adset: z.object({name:z.string().default('')}).optional(), campaign: z.object({name:z.string().default('')}).optional(),
  creative: z.object({id:z.string(),name:z.string().optional()}).optional() });
const metricSchema = z.object({ ad_id:z.string(),date_start:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account_currency:z.string().length(3),spend:z.string(),impressions:z.string(),clicks:z.string(),reach:z.string().optional(),
  publisher_platform:z.string().optional(),country:z.string().optional(),actions:z.array(z.object({action_type:z.string(),value:z.string()})).optional() });
const hourlySchema = z.object({ ad_id:z.string(),date_start:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),account_currency:z.string().length(3),spend:z.string(),
  impressions:z.string(),clicks:z.string(),hourly_stats_aggregated_by_advertiser_time_zone:z.string().regex(/^\d{2}:\d{2}:\d{2}/),
  actions:z.array(z.object({action_type:z.string(),value:z.string()})).optional() });

/** Independent grains: never add AD, PLATFORM and COUNTRY rows together. Reach is never summed across days. */
export async function syncAdFacts(token:string,accountId:string) {
  const run=await db.syncJob.create({data:{provider:'META',jobType:'AD_FACTS',status:'RUNNING'}});
  let succeeded=0,failed=0;
  const errors:string[]=[];
  try {
    const directory=await pagedGraphGet<unknown>(`act_${accountId}/ads`,token,{fields:'id,name,adset_id,campaign_id,adset{name},campaign{name},creative{id,name}',limit:'500'});
    if(directory.error)errors.push(directory.error);
    for(const raw of directory.rows){
      const parsed=adSchema.safeParse(raw);if(!parsed.success){failed++;continue;}
      const ad=parsed.data;
      const data={adName:ad.name,adsetId:ad.adset_id,adsetName:ad.adset?.name||'',campaignId:ad.campaign_id,campaignName:ad.campaign?.name||'',
        creativeId:ad.creative?.id,creativeName:ad.creative?.name,syncedAt:new Date()};
      await db.adDimension.upsert({where:{accountId_adId:{accountId,adId:ad.id}},create:{accountId,adId:ad.id,...data},update:data});
    }
    for(const [grain,breakdown] of [['AD',''],['PLATFORM','publisher_platform'],['COUNTRY','country']]){
      const result=await pagedGraphGet<unknown>(`act_${accountId}/insights`,token,{level:'ad',date_preset:'last_30d',time_increment:'1',limit:'500',
        fields:'ad_id,date_start,account_currency,spend,impressions,reach,clicks,actions',...(breakdown?{breakdowns:breakdown}:{})});
      if(result.error){errors.push(`${grain}:${result.error}`);continue;} // Do not commit an incomplete paging result.
      for(const raw of result.rows)try{
        const m=metricSchema.parse(raw);const spend=new Prisma.Decimal(m.spend);
        if(!spend.isFinite()||spend.isNegative())throw new Error('INVALID_SPEND');
        const count=(value:string)=>{const n=Number(value);if(!Number.isInteger(n)||n<0||n>2147483647)throw new Error('INVALID_COUNT');return n;};
        const key={accountId,adId:m.ad_id,metricDate:new Date(`${m.date_start}T00:00:00Z`),grain,platform:m.publisher_platform||'ALL',country:m.country||'ALL'};
        const data={currency:m.account_currency,spend,impressions:count(m.impressions),clicks:count(m.clicks),reach:m.reach===undefined?null:count(m.reach),leads:leadCountFromActions(m.actions),syncedAt:new Date()};
        await db.adDailyMetric.upsert({where:{accountId_adId_metricDate_grain_platform_country:key},create:{...key,...data},update:data});succeeded++;
      }catch{failed++;}
    }
    // Hourly spend (国家作战卡 投放时段): Meta reports the hour in the ad account's time zone; a separate grain, never added to the daily rows.
    const hourly=await pagedGraphGet<unknown>(`act_${accountId}/insights`,token,{level:'ad',date_preset:'last_30d',time_increment:'1',limit:'500',
      fields:'ad_id,date_start,account_currency,spend,impressions,clicks,actions',breakdowns:'hourly_stats_aggregated_by_advertiser_time_zone'});
    if(hourly.error)errors.push(`HOURLY:${hourly.error}`);
    else for(const raw of hourly.rows)try{
      const m=hourlySchema.parse(raw);const spend=new Prisma.Decimal(m.spend);
      if(!spend.isFinite()||spend.isNegative())throw new Error('INVALID_SPEND');
      const hour=Number(m.hourly_stats_aggregated_by_advertiser_time_zone.slice(0,2));
      if(!Number.isInteger(hour)||hour<0||hour>23)throw new Error('INVALID_HOUR');
      const count=(value:string)=>{const n=Number(value);if(!Number.isInteger(n)||n<0||n>2147483647)throw new Error('INVALID_COUNT');return n;};
      const key={accountId,adId:m.ad_id,metricDate:new Date(`${m.date_start}T00:00:00Z`),hour};
      const data={currency:m.account_currency,spend,impressions:count(m.impressions),clicks:count(m.clicks),leads:leadCountFromActions(m.actions),syncedAt:new Date()};
      await db.adHourlyMetric.upsert({where:{accountId_adId_metricDate_hour:key},create:{...key,...data},update:data});succeeded++;
    }catch{failed++;}
    await db.syncJob.update({where:{id:run.id},data:{status:errors.length||failed?'PARTIAL':'OK',completedAt:new Date(),processed:succeeded+failed,succeeded,failed,error:errors.join(';').slice(0,2000)}});
  }catch{await db.syncJob.update({where:{id:run.id},data:{status:'FAILED',completedAt:new Date(),succeeded,failed:failed+1,error:'AD_FACTS_FAILED'}});errors.push('AD_FACTS_FAILED');}
  return {runId:run.id,succeeded,failed,errors};
}
