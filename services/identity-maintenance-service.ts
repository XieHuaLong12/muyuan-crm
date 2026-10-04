import { z } from 'zod';
import { db } from '@/lib/db';
import { processPendingIntelligence } from './customer-intelligence-service';
import { dailyAdvertisingInsight } from './identity-analytics-service';
import { deliverAdvertisingFeedback } from './advertising-feedback-service';
import { retryPendingMetaLeads } from './meta-lead-service';

/** Server worker, isolated failures: no channel outage stops another channel. */
export async function identityMaintenance(input:unknown) {
  const v=z.object({kind:z.enum(['leads','analysis','daily','feedback','all']).default('analysis')}).parse(input);
  const admin=await db.user.findFirstOrThrow({where:{role:'ADMIN'},select:{id:true,name:true,email:true,role:true},orderBy:{createdAt:'asc'}});
  const result:Record<string,unknown>={};
  if(v.kind==='leads'||v.kind==='all')try{result.leads=await retryPendingMetaLeads({limit:3},admin);}catch{result.leads={status:'FAILED_RETRYABLE'};}
  try{result.reconcile=await (await import('./identity-chain-service')).reconcilePendingIdentityMessages({limit:100},admin);}catch{result.reconcile={status:'FAILED_RETRYABLE'};}
  if(v.kind==='analysis'||v.kind==='all')try{result.analysis=await processPendingIntelligence({limit:3},admin);}catch{result.analysis={status:'FAILED_RETRYABLE'};}
  if(v.kind==='daily'||v.kind==='all')try{result.daily=await dailyAdvertisingInsight({preset:'yesterday'},admin);}catch{result.daily={status:'FAILED_RETRYABLE'};}
  if(v.kind==='feedback'||v.kind==='all')try{result.feedback=await deliverAdvertisingFeedback({limit:20},admin);}catch{result.feedback={status:'FAILED_RETRYABLE'};}
  return result;
}
