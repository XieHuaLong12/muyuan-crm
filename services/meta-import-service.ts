import { createHash,randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withPhoneCountry } from '@/lib/phone-country';
import { Actor,HttpError,requireAdmin } from '@/lib/auth';
import { dayKey } from '@/lib/time';
import { parseInquiryDate } from '@/lib/customer-date';
import { metaFields,identifyHeader,parseMetaCsv,normHeader,MetaField,MetaValues,MetaRow,MetaPreview,MetaDecision } from '@/lib/meta-import';
import { normalizePhone } from './customer-service';
import { canonicalEmail, canonicalPhone, sourceInstant } from '@/lib/contact-identity';
import { lockIdentity, rememberCustomerContacts, recordLeadAttribution } from './contact-identity-service';
import { retryTransaction } from '@/lib/transaction-retry';
import { translator } from './meta-translation-service';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const fieldEnum=z.enum(Object.keys(metaFields) as [MetaField,...MetaField[]]);
const previewSchema=z.object({filename:z.string().min(1).max(200),text:z.string().max(2_000_000),mapping:z.record(fieldEnum).optional(),overrides:z.record(z.record(z.string().max(5000))).optional(),decisions:z.record(z.object({action:z.enum(['create','link']),customerId:z.string().optional()})).optional()});
type Draft={userId:string;fileHash:string;expires:number;preview:MetaPreview;decisions:Record<string,MetaDecision>};
const drafts=new Map<string,Draft>();
function admin(user:Actor){requireAdmin(user, '智能导入需要管理员权限');}
const phones=(c:{phone:string;whatsapp:string;countryCode?:string})=>[canonicalPhone(c.phone,c.countryCode,true),canonicalPhone(c.whatsapp,undefined,true)].filter((v):v is string=>!!v).map(v=>v.slice(1));
const email=(s:string)=>s.trim().toLowerCase();
type Candidate={id:string;name:string;companyName:string;phones:string[];emails:string[];deleted:boolean;ordinal:number};
const scientific=(s:string)=>/^\d[\d.]*e[+-]?\d+$/i.test(s.replace(/^[pl]:/i,''));

const importedStageLabels:Record<string,string>={'new':'新客户','new_customer':'新客户','contacted':'已联系','replied':'已回复','catalogue_sent':'已回复','catalog_sent':'已回复','style_confirmed':'已确认需求','needs_confirmed':'已确认需求','quoted':'已报价','follow_up':'跟进中','won':'已成交','not_needed_now':'暂不需要','paused':'暂不需要','invalid_lead':'无效客户','新客户':'新客户','已联系':'已联系','已回复':'已回复','已发目录':'已回复','已发送目录':'已回复','已确认款式':'已确认需求','已确认需求':'已确认需求','已报价':'已报价','跟进中':'跟进中','已成交':'已成交','暂不需要':'暂不需要','无效客户':'无效客户'};
const stageCodes:Record<string,string>={'新客户':'NEW','已联系':'CONTACTED','已回复':'REPLIED','已确认需求':'NEEDS_CONFIRMED','已报价':'QUOTED','跟进中':'FOLLOW_UP','已成交':'WON','暂不需要':'PAUSED','无效客户':'INVALID'};
const importedCustomerTypes:Record<string,string>={'wholesaler':'批发商','grossiste':'批发商','importer':'进口商','importateur':'进口商','distributor':'经销商','distributeur':'经销商','furniture_retailer':'家具零售','détaillant_de_meubles':'家具零售','detaillant_de_meubles':'家具零售','online_seller_/_e-commerce':'电商客户','online_seller_/_ecommerce':'电商客户','brand':'品牌客户','interior_designer_/_project_business':'其他','i_am_buying_for_personal_use':'其他','other_business':'其他','批发商':'批发商','进口商':'进口商','经销商':'经销商','家具零售':'家具零售','品牌客户':'品牌客户','电商客户':'电商客户','其他':'其他'};
function normalizeImportedStage(value:string){if(!value.trim())return '';const raw=value.trim();const key=raw.toLowerCase().replace(/[\s-]+/g,'_');return importedStageLabels[key]??importedStageLabels[raw]??'';}
function normalizeCustomerType(value:string){if(!value.trim())return '';const raw=value.trim();const key=raw.toLowerCase().replace(/\s+/g,'_');return importedCustomerTypes[key]??importedCustomerTypes[raw]??'';}

export function metaDate(value:string,tz:string){
 let v=value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /,'$1T').replace(/([+-]\d{2})(\d{2})$/,'$1:$2');
 if(/^\d{4}\/\d{2}\/\d{2}$/.test(v))v=v.replaceAll('/','-');
 return dayKey(parseInquiryDate(v,tz),tz);
}
function statusSignature(row:MetaRow){return JSON.stringify([row.status,row.targetId,row.ordinal,row.candidates.map(c=>c.id).sort()]);}

async function classify(rows:MetaRow[],decisions:Record<string,MetaDecision>,client:Prisma.TransactionClient=db){
 const customers=await client.customer.findMany({include:{submissions:{select:{ordinal:true,values:true}},contactIdentities:{select:{kind:true,normalized:true}}}});
 const candidates:Candidate[]=customers.map(c=>{
  const history=c.submissions.flatMap(s=>{
    try{
      const parsed=JSON.parse(s.values);

      if(
        parsed &&
        typeof parsed==='object' &&
        !Array.isArray(parsed)
      ){
        return [parsed as MetaValues];
      }

      return [];
    }catch{
      return [];
    }
  });

  return {
    id:c.id,
    name:c.name,
    companyName:c.companyName,

    phones:[
      ...new Set([
        ...phones(c),
        ...c.contactIdentities.filter(a=>a.kind==='PHONE').map(a=>a.normalized.slice(1)),
        ...history.flatMap(phones)
      ])
    ],

    emails:[
      ...new Set([
        c.email,
        ...c.contactIdentities.filter(a=>a.kind==='EMAIL').map(a=>a.normalized),
        ...history.map(v=>v.email)
      ]
        .filter(Boolean)
        .map(email)
      )
    ],

    deleted:!!c.deletedAt,

    ordinal:Math.max(
      1,
      ...c.submissions.map(s=>s.ordinal)
    )
  };
});
 const imported=new Set((await client.leadSubmission.findMany({where:{eventKey:{in:rows.map(r=>r.key)}},select:{eventKey:true}})).map(r=>r.eventKey));
 for(const l of await client.customerLeadAttribution.findMany({where:{leadKey:{in:rows.map(r=>r.key)},customerId:{not:null},status:'MATCHED'},select:{leadKey:true}}))imported.add(l.leadKey);
 for(const e of await client.metaLeadEvent.findMany({where:{leadgenId:{in:rows.filter(r=>r.key.startsWith('meta:')).map(r=>r.key.slice(5))},customerId:{not:null},status:{in:['CREATED','LINKED']}},select:{leadgenId:true}}))imported.add(`meta:${e.leadgenId}`);
 const seen=new Set<string>();
 const ordered=[...rows].sort((a,b)=>a.values.inquiryAt.localeCompare(b.values.inquiryAt)||a.row-b.row);
 for(const row of ordered){
  row.targetId=undefined;row.ordinal=undefined;row.candidates=[];
  if(imported.has(row.key)||seen.has(row.key)){row.status='IMPORTED';row.reason=imported.has(row.key)?'该 Meta Lead / 原始记录已导入，不新增留资次数':'文件内同一条留资重复出现，跳过';continue;}
  seen.add(row.key);
  const v=row.values;
  if(row.warnings.some(w=>w.startsWith('阻止：'))){row.status='INVALID';row.reason='请补充或修正必填字段后重新预览';continue;}
  const p=phones(v),e=email(v.email);
  const phoneMatches=candidates.filter(c=>p.some(n=>c.phones.includes(n)));
  const exact=phoneMatches.length?phoneMatches:candidates.filter(c=>e&&c.emails.includes(e));
  const weak=exact.length?[]:candidates.filter(c=>p.some(n=>c.phones.some(m=>Math.min(n.length,m.length)>=8&&n.slice(-8)===m.slice(-8)))||v.name&&normHeader(c.name)===normHeader(v.name));
  const matches=exact.length?exact:weak;
  row.candidates=matches.map(c=>({id:c.id,name:c.name,deleted:c.deleted}));
  const decision=decisions[String(row.row)];
  let target:Candidate|undefined;
  if(decision?.action==='link'){
   target=matches.find(c=>c.id===decision.customerId&&!c.deleted);
   if(!target){row.status='SUSPECT';row.reason='选中的客户不再匹配或已删除，请重新核对';continue;}
  }else if(decision?.action!=='create'&&exact.length===1&&!exact[0].deleted)target=exact[0];
  if(target){
   row.status='REPEAT';row.reason='联系方式匹配，追加留资历史，保留客户原资料';row.targetId=target.id;row.ordinal=++target.ordinal;
   target.phones=[...new Set([...target.phones,...p])];if(e&&!target.emails.includes(e))target.emails.push(e);
  }else if(decision?.action!=='create'&&(matches.length||!p.length&&!e)){
   row.status='SUSPECT';row.reason=matches.some(c=>c.deleted)?'匹配到回收站客户，请先恢复或明确作为不同客户处理':exact.length>1?'联系方式对应多个客户，请选择正确客户':matches.length?'仅姓名或电话号码尾号相似，请人工核对':'缺少可查重的联系方式，请补充或明确作为新客户';
  }else{
   row.status='NEW';row.ordinal=1;row.reason=decision?.action==='create'?'已人工确认作为不同的新客户':'未发现匹配客户';
   candidates.push({id:`row:${row.row}`,name:v.name,companyName:v.companyName,phones:p,emails:e?[e]:[],deleted:false,ordinal:1});
  }
 }
 return rows;
}

export async function previewMeta(input:unknown,user:Actor):Promise<MetaPreview>{
 admin(user);const request=previewSchema.parse(input);
 let csv:ReturnType<typeof parseMetaCsv>;try{csv=parseMetaCsv(request.text);}catch(e){throw new HttpError(400,(e as Error).message);}
 const mapping=Object.fromEntries(csv.headers.map(h=>[h,request.mapping?.[h]??identifyHeader(h)]));
 const ambiguous:string[]=[];
 if(!request.mapping||!Object.keys(request.mapping).length){
  const fields=Object.values(mapping).filter(v=>v!=='ignore'&&v!=='notes');
  for(const field of new Set(fields))if(fields.filter(f=>f===field).length>1){ambiguous.push(metaFields[field]);for(const header of csv.headers)if(mapping[header]===field)mapping[header]='ignore';}
 }
 const assigned=Object.values(mapping).filter(v=>v!=='ignore'&&v!=='notes');
 if(new Set(assigned).size!==assigned.length)throw new HttpError(400,'多个列映射到同一字段，请在字段对应中选择要使用的列；其余列可保留为补充回答');
 const settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
 const translation=await translator();const rows:MetaRow[]=[];
 for(let index=0;index<csv.rows.length;index++){
  const original=csv.rows[index],mapped:Partial<Record<MetaField,string>>={};
  for(const [header,value] of Object.entries(original))if(mapping[header]!=='ignore'){
   const f=mapping[header];mapped[f]=f==='notes'&&mapped[f]?`${mapped[f]}\n${header}: ${value}`:value;
  }
  if(!mapped.name&&(mapped.firstName||mapped.lastName))mapped.name=[mapped.firstName,mapped.lastName].filter(Boolean).join(' ');
  const values=Object.fromEntries(Object.keys(metaFields).filter(k=>!['ignore','firstName','lastName'].includes(k)).map(k=>[k,mapped[k as MetaField]??''])) as MetaValues;
  values.leadId=values.leadId.replace(/^l:/i,'');
  values.phone=values.phone.replace(/^p:/i,'');values.whatsapp=values.whatsapp.replace(/^p:/i,'');
  // Identity is derived from source data before corrections/translations. Re-export order and names do not affect it.
  const canonical=JSON.stringify(Object.entries(original).map(([k,v])=>[normHeader(k),v]).sort(([a],[b])=>a.localeCompare(b)));
  const key=values.leadId?`meta:${values.leadId}`:`row:${hash(canonical)}`;
  const row:MetaRow={row:index+2,key,values,original,status:'NEW',reason:'',warnings:ambiguous.map(f=>`多列可能对应${f}，未自动选择，请展开字段对应核对`),pending:[],candidates:[]};
  const overrides=request.overrides?.[String(row.row)]??{};
  for(const [f,value] of Object.entries(overrides))if(Object.hasOwn(values,f)&&!['leadId','formId'].includes(f))values[f as keyof MetaValues]=value.trim();
  const originalStage=values.stage;if(originalStage){const normalizedStage=normalizeImportedStage(originalStage);if(normalizedStage)values.stage=normalizedStage;else row.warnings.push(`阻止：未识别客户阶段「${originalStage}」，请人工确认`);}

  const originalCustomerType=values.customerType;if(originalCustomerType){const normalizedCustomerType=normalizeCustomerType(originalCustomerType);if(normalizedCustomerType)values.customerType=normalizedCustomerType;else{row.warnings.push(`客户身份「${originalCustomerType}」未识别，将按“其他”处理`);values.customerType='其他';}}
  if(!values.name)row.warnings.push('阻止：缺少客户姓名，请补充原始姓名');
  try{values.inquiryAt=metaDate(values.inquiryAt,settings.timezone);}catch{row.warnings.push('阻止：询盘日期缺失、不合法或在未来，请按原始资料补充 YYYY-MM-DD 日期');}
  for(const field of ['leadId','phone','whatsapp'] as const)if(scientific(values[field]))row.warnings.push(`阻止：${metaFields[field]} 已变成科学计数法，请重新下载 Meta 原始 CSV，不能恢复或猜测丢失数字`);
  if(values.email&&!z.string().email().safeParse(values.email).success)row.warnings.push('阻止：邮箱格式不合法');
  if(values.quantity&&!/^\d+$/.test(values.quantity))row.warnings.push('数量不是明确整数，采购数量留空，原回答保留在留资历史');
  if(/^\d+$/.test(values.quantity)&&Number(values.quantity)>2147483647)row.warnings.push('阻止：采购数量超过可存储范围');
  const platform=values.source.toLowerCase();values.source=['fb','facebook'].includes(platform)?'FACEBOOK':['ig','instagram'].includes(platform)?'INSTAGRAM':['FACEBOOK','INSTAGRAM'].includes(values.source)?values.source:'';
  if(!values.source)row.warnings.push('未识别 Facebook / Instagram 来源，留空待确认');
  for(const field of ['customerType','productInterest','salesMarket','concerns','country','city','notes'] as const){
   // A manual Chinese correction takes precedence; proper fields are never submitted for translation.
   const result=await translation.translate(values[field],[values.name,values.companyName,values.email,values.productModel,values.adName,values.phone,values.whatsapp]);values[field]=result.text;if(result.pending)row.pending.push(metaFields[field]);
  }
  if(!mapped.leadId)row.warnings.push('没有 Meta Lead ID：使用原始整行指纹查重；请保留原始导出文件');
  rows.push(row);
 }
 await classify(rows,request.decisions??{});
 for(const [id,draft] of drafts)if(draft.expires<Date.now())drafts.delete(id);
 // Bound memory used by abandoned previews. Drafts contain private data and expire after 30 minutes.
 while(drafts.size>=20)drafts.delete(drafts.keys().next().value!);
 const token=randomUUID(),expires=Date.now()+30*60_000;
 const preview={token,filename:request.filename,headers:csv.headers,mapping,rows,translationConfigured:translation.configured,expiresAt:new Date(expires).toISOString()};
 drafts.set(token,{preview,userId:user.id,fileHash:hash(request.text),expires,decisions:request.decisions??{}});
 return preview;
}

const purchaseCodes:Record<string,string>={'批发商':'WHOLESALE','进口商':'IMPORTER','经销商':'DISTRIBUTOR','家具零售':'RETAILER','品牌客户':'BRAND','电商客户':'ECOMMERCE','其他':'OTHER'};
let commitQueue:Promise<unknown>=Promise.resolve();
export function commitMeta(input:unknown,user:Actor){
 const next=commitQueue.then(()=>executeCommitMeta(input,user),()=>executeCommitMeta(input,user));
 commitQueue=next.catch(()=>undefined);return next;
}
async function executeCommitMeta(input:unknown,user:Actor){
 admin(user);const v=z.object({token:z.string().uuid(),rows:z.array(z.number().int()).min(1).max(500),confirmed:z.literal(true),allowPendingTranslation:z.boolean().default(false),ownerId:z.string().max(191).default('')}).parse(input);
 const existing=await db.metaImportRun.findUnique({where:{id:v.token}});if(existing){if(existing.userId!==user.id)throw new HttpError(403,'无权使用此预览');return existing.resultPayload??JSON.parse(existing.result);}
 const draft=drafts.get(v.token);if(!draft||draft.expires<Date.now())throw new HttpError(409,'预览已过期或服务已重启，请重新上传预览');if(draft.userId!==user.id)throw new HttpError(403,'无权使用此预览');
 const selected=new Set(v.rows),rows=draft.preview.rows.filter(r=>selected.has(r.row));
 if(rows.length!==selected.size)throw new HttpError(400,'包含不属于当前预览的行');
 if(rows.some(r=>!['NEW','REPEAT'].includes(r.status)))throw new HttpError(400,'只能确认新客户或已核对的重复留资；请先处理疑似重复和错误');
 if(!v.allowPendingTranslation&&rows.some(r=>r.pending.length))throw new HttpError(400,'部分回答尚未翻译，请先处理或明确选择保留原文待处理');
 const settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
 // 导入时可直接指定负责人；留空则按线索分配规则（待分配池或轮流分配）。
 if(v.ownerId&&!await db.user.findFirst({where:{id:v.ownerId,isActive:true}}))throw new HttpError(400,'负责人不存在或账号已停用');
 const assignment=await import('./lead-assignment-service');
 return retryTransaction(() => db.$transaction(async tx=>{
  await lockIdentity(tx);
  const done=await tx.metaImportRun.findUnique({where:{id:v.token}});if(done)return done.resultPayload??JSON.parse(done.result);
  const fresh=await classify(structuredClone(draft.preview.rows),draft.decisions,tx);
  if(rows.some(row=>statusSignature(row)!==statusSignature(fresh.find(r=>r.row===row.row)!)))throw new HttpError(409,'客户或留资记录已变化，为避免重复请重新预览');
  const result={created:0,repeated:0,skipped:draft.preview.rows.length-rows.length,customerIds:[] as string[]};
  const newIds=new Map<string,string>();
  for(const row of [...rows].sort((a,b)=>a.values.inquiryAt.localeCompare(b.values.inquiryAt)||a.row-b.row)){
   const f=row.values;let customerId=row.targetId;
   if(customerId?.startsWith('row:'))customerId=newIds.get(customerId);
   if(row.status==='REPEAT'&&!customerId)throw new HttpError(400,'同文件中的首次留资未选中，请同时选择首次留资行');
   if(row.status==='NEW'){const importedStage=stageCodes[f.stage]??'NEW';const importedPurchaseType=purchaseCodes[f.customerType]??'OTHER';const intake=v.ownerId?{ownerId:v.ownerId,pending:false,explicit:true}:await assignment.resolveIntakeOwner(tx);
    const c=await tx.customer.create({data:{name:f.name,companyName:f.companyName,...withPhoneCountry({phone:f.phone,whatsapp:f.whatsapp,country:f.country}),whatsappNormalized:normalizePhone(f.whatsapp),email:f.email,city:f.city,source:f.source,sourceDetail:[f.adName,f.campaignName,f.formName].filter(Boolean).join(' · '),productInterest:f.productInterest,productModel:f.productModel,purchaseType:importedPurchaseType,quantity:/^\d+$/.test(f.quantity)?Number(f.quantity):null,inquiryAt:sourceInstant(Object.entries(row.original).find(([header])=>draft.preview.mapping[header]==='inquiryAt')?.[1])||parseInquiryDate(f.inquiryAt,settings.timezone),ownerId:intake.ownerId,currency:settings.currency,stage:importedStage,stageSource:f.stage?'HUMAN':'SYSTEM',isQualified:importedStage==='INVALID'?false:null,notes:[f.salesMarket&&`销售市场：${f.salesMarket}`,f.concerns&&`关注点：${f.concerns}`,f.notes].filter(Boolean).join('\n')}});
    customerId=c.id;newIds.set(`row:${row.row}`,c.id);result.created++;
    await tx.stageHistory.create({data:{customerId,changedBy:user.id,toStage:importedStage,note:'CSV 智能导入'}});
    await assignment.enterIntake(tx,customerId,user.id,intake,'CSV 智能导入');
   }else{const old=await tx.customer.findUniqueOrThrow({where:{id:customerId!}});const importedStage=f.stage?stageCodes[f.stage]:undefined;const importedPurchaseType=f.customerType?purchaseCodes[f.customerType]:undefined;const stageChanged=!!importedStage&&old.stage!==importedStage;const purchaseTypeChanged=!!importedPurchaseType&&old.purchaseType!==importedPurchaseType;if(stageChanged||purchaseTypeChanged||importedStage&&old.stageSource!=='HUMAN')await tx.customer.update({where:{id:customerId!},data:{...(importedStage?{stageSource:'HUMAN'}:{}),...(stageChanged?{stage:importedStage,isQualified:importedStage==='INVALID'?false:old.stage==='INVALID'?null:old.isQualified}:{}),...(purchaseTypeChanged?{purchaseType:importedPurchaseType}:{})}});if(stageChanged)await tx.stageHistory.create({data:{customerId:customerId!,fromStage:old.stage,toStage:importedStage!,changedBy:user.id,note:'CSV 智能导入同步阶段'}});result.repeated++;}
   const previous=await tx.leadSubmission.aggregate({where:{customerId:customerId!},_max:{ordinal:true}});
   const ordinal=row.status==='NEW'?1:Math.max(1,previous._max.ordinal??1)+1;
   if(ordinal!==row.ordinal)throw new HttpError(400,'同一客户的多次留资请按顺序选中，包含更早的留资行，以保持编号与预览一致');
   await tx.leadSubmission.create({data:{customerId:customerId!,eventKey:row.key,leadId:f.leadId,ordinal,occurredAt:sourceInstant(Object.entries(row.original).find(([header])=>draft.preview.mapping[header]==='inquiryAt')?.[1])||parseInquiryDate(f.inquiryAt,settings.timezone),values:JSON.stringify(f),raw:JSON.stringify(row.original),filename:draft.preview.filename,fileHash:draft.fileHash,translationPending:JSON.stringify(row.pending)}});
   await rememberCustomerContacts(tx,customerId!,'META_CSV');
   const original=(key:string)=>Object.entries(row.original).find(([header])=>normHeader(header)===normHeader(key))?.[1]?.replace(/^[a-z]:/i,'')||null;
   await recordLeadAttribution(tx,{leadKey:row.key,leadId:f.leadId||null,customerId:customerId!,status:'MATCHED',matchMethod:draft.decisions[String(row.row)]?'MANUAL':row.status==='NEW'?'CREATED':'PHONE',confidence:100,
     occurredAt:sourceInstant(Object.entries(row.original).find(([header])=>draft.preview.mapping[header]==='inquiryAt')?.[1])||parseInquiryDate(f.inquiryAt,settings.timezone),
     phoneRaw:f.whatsapp||f.phone,phoneE164:canonicalPhone(f.whatsapp||f.phone,undefined,true),emailNormalized:canonicalEmail(f.email),platform:f.source||null,
     accountId:original('account_id'),campaignId:original('campaign_id'),campaignName:f.campaignName||null,adsetId:original('adset_id'),adsetName:original('adset_name'),adId:original('ad_id'),adName:f.adName||null,creativeId:original('creative_id'),creativeName:original('creative_name'),formId:f.formId?.replace(/^f:/i,'')||null,formName:f.formName||null,source:'CSV',answers:row.original},
     [f.phone,f.whatsapp].flatMap(raw=>{const normalized=canonicalPhone(raw,undefined,true);return normalized?[{raw,normalized}]:[];}));
   result.customerIds.push(customerId!);
  }
  await tx.metaImportRun.create({data:{id:v.token,userId:user.id,result:JSON.stringify(result).length<=191?JSON.stringify(result):JSON.stringify({...result,customerIds:[]}),resultPayload:result}});
  return result;
 },{timeout:30000}));
}
