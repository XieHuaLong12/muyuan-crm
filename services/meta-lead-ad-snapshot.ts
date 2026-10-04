import { z } from 'zod';
import { graphGet } from '@/lib/meta-graph';
import { db } from '@/lib/db';

const schema=z.object({id:z.string(),account_id:z.string(),name:z.string().optional(),adset_id:z.string().optional(),campaign_id:z.string().optional(),adset:z.object({name:z.string().optional()}).optional(),campaign:z.object({name:z.string().optional()}).optional(),creative:z.object({id:z.string(),name:z.string().optional()}).optional()});
/** Captured at lead processing time. No present-day cache is used to invent an old creative. */
export async function fetchLeadAdSnapshot(adId?:string){
  const token=process.env.META_ADS_ACCESS_TOKEN?.trim();if(!adId||!token)return null;
  const startedAt=new Date();
  const response=await graphGet<unknown>(encodeURIComponent(adId),token,{fields:'id,account_id,name,adset_id,campaign_id,adset{name},campaign{name},creative{id,name}'});
  const parsed=response.ok?schema.safeParse(response.data):null;
  if(parsed?.success&&parsed.data.id===adId)return parsed.data;
  // A failed optional ad lookup does not reject the already fetched lead.
  await db.syncJob.create({data:{provider:'META',jobType:'LEAD_AD_SNAPSHOT',status:'FAILED',startedAt,completedAt:new Date(),processed:1,failed:1,error:response.ok?'INVALID_AD_SNAPSHOT':response.error}}).catch(()=>undefined);
  return null;
}
