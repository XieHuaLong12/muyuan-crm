import { Prisma } from '@prisma/client';
import { identityKey } from '@/lib/contact-identity';
import { recordLeadAttribution } from './contact-identity-service';

const string = (r:Record<string,unknown>,key:string,max=2000) => typeof r[key]==='string' ? (r[key] as string).slice(0,max) : null;
export async function recordCtwaAttribution(tx:Prisma.TransactionClient,input:{provider:string;accountId:string;messageId:string;
  customerId:string|null;phoneRaw:string;phoneE164:string|null;at:Date|null;referral:Record<string,unknown>;status:string}) {
  const r=input.referral, adId=string(r,'source_type')==='ad'?string(r,'source_id',191):null;
  const existing=await tx.customerLeadAttribution.findUnique({where:{leadKey:`ctwa:${identityKey(input.provider,input.accountId,input.messageId)}`}});
  if(existing)return existing; // Names and identity are immutable once recorded.
  // Only enrich from this configured Meta account; an ID on a post is never an Ad ID.
  const accountId=process.env.META_AD_ACCOUNT_ID?.replace(/^act_/,'');
  const dimension=adId&&accountId?await tx.adDimension.findFirst({where:{adId,accountId:{in:[accountId,`act_${accountId}`]}}}):null;
  const referral={sourceType:string(r,'source_type',40),sourceId:string(r,'source_id',191),sourceUrl:string(r,'source_url'),
    headline:string(r,'headline'),body:string(r,'body',6000),ctwaClid:string(r,'ctwa_clid'),mediaType:string(r,'media_type',40)};
  return recordLeadAttribution(tx,{leadKey:`ctwa:${identityKey(input.provider,input.accountId,input.messageId)}`,source:'CTWA',
    customerId:input.customerId,status:input.customerId?'MATCHED':input.status==='AMBIGUOUS'?'AMBIGUOUS':'UNMATCHED',
    matchMethod:input.customerId?'PHONE':'NONE',confidence:input.customerId?100:0,occurredAt:input.at,
    phoneRaw:input.phoneRaw,phoneE164:input.phoneE164,platform:'META',accountId:dimension?.accountId||accountId||null,
    adId,adName:dimension?.adName||null,campaignId:dimension?.campaignId||null,campaignName:dimension?.campaignName||null,
    adsetId:dimension?.adsetId||null,adsetName:dimension?.adsetName||null,creativeId:dimension?.creativeId||null,creativeName:dimension?.creativeName||null,
    answers:{referral,dimensionSyncedAt:dimension?.syncedAt?.toISOString()||null,availability:dimension?'SNAPSHOT_FROM_SYNCED_META':'DATA_UNAVAILABLE'} as Prisma.InputJsonValue});
}
