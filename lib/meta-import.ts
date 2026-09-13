export const metaFields={ignore:'不映射（保留原文）',leadId:'Meta Lead ID',formId:'表单 ID',formName:'表单名称',name:'客户姓名',firstName:'名',lastName:'姓',companyName:'公司名',whatsapp:'WhatsApp',phone:'电话',email:'邮箱',inquiryAt:'询盘日期',source:'Facebook / Instagram',adName:'广告名称',campaignName:'广告系列',customerType:'客户类型',productInterest:'意向产品',productModel:'产品型号',quantity:'采购数量',salesMarket:'销售市场',concerns:'关注点',country:'国家',city:'城市',notes:'补充回答'} as const;
export type MetaField=keyof typeof metaFields;
export type MetaValues=Record<Exclude<MetaField,'ignore'|'firstName'|'lastName'>,string>;
export type MetaStatus='NEW'|'REPEAT'|'IMPORTED'|'SUSPECT'|'INVALID';
export const metaStatuses:Record<MetaStatus,string>={NEW:'新客户',REPEAT:'重复留资',IMPORTED:'已导入',SUSPECT:'疑似重复',INVALID:'待补充'};
export type MetaRow={row:number;key:string;values:MetaValues;original:Record<string,string>;status:MetaStatus;reason:string;pending:string[];warnings:string[];candidates:{id:string;name:string;deleted:boolean}[];targetId?:string;ordinal?:number};
export type MetaPreview={token:string;filename:string;headers:string[];mapping:Record<string,MetaField>;rows:MetaRow[];translationConfigured:boolean;expiresAt:string};
export type MetaDecision={action:'create'|'link';customerId?:string};
export type MetaSubmission={id:string;ordinal:number;occurredAt:string;values:string;raw:string;filename:string;createdAt:string;translationPending:string};
export const normHeader=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const aliases:Partial<Record<MetaField,string[]>>={
 leadId:['id','lead id','leadgen id','identifiant du prospect','潜在客户编号','线索id'],formId:['form id','id du formulaire'],formName:['form name','nom du formulaire'],name:['full name','name','nom complet','姓名','客户姓名'],firstName:['first name','prenom'],lastName:['last name','surname','nom de famille'],companyName:['company name','company','nom de l entreprise','entreprise','公司','公司名称'],whatsapp:['whatsapp','whatsapp number','numero whatsapp','whatsapp phone number'],phone:['phone number','phone','telephone','numero de telephone','mobile','手机号','电话'],email:['email','e mail','email address','adresse e mail','courriel','邮箱'],inquiryAt:['created time','created at','creation time','date de creation','询盘日期','创建时间','date created'],source:['platform','source','plateforme','来源'],adName:['ad name','nom de la publicite','广告名称'],campaignName:['campaign name','nom de la campagne','广告系列名称'],customerType:['customer type','business type','type de client','type d entreprise','客户类型'],productInterest:['product','product interest','interested product','produit','produit souhaite','意向产品'],productModel:['product model','model','modele','产品型号','型号'],quantity:['quantity','purchase quantity','quantite','quantite d achat','采购数量','数量'],salesMarket:['sales market','target market','market','marche','marche de vente','销售市场'],concerns:['concerns','main concern','points importants','preoccupations','关注点'],country:['country','pays','国家'],city:['city','ville','城市'],notes:['notes','comments','message','备注']
};
export function identifyHeader(header:string):MetaField{
 const normalized=normHeader(header);
 for(const [field,names] of Object.entries(aliases))if(names.some(a=>normHeader(a)===normalized))return field as MetaField;
 // Only specific question patterns; generic words such as "name" must not map ad names to people.
 const rules:[RegExp,MetaField][]=[[/whats\s?app/i,'whatsapp'],[/phone number|numero de telephone|电话号码/i,'phone'],[/what.*(?:type of business|customer type)|type.*(?:entreprise|client)|客户类型/i,'customerType'],[/which.*product|what.*product.*interest|quel.*produit|感兴趣.*产品/i,'productInterest'],[/how many|purchase quantity|quelle.*quantite|采购数量/i,'quantity'],[/sales market|target market|quel.*marche|销售市场/i,'salesMarket'],[/main concern|most important|preoccup|关注点/i,'concerns']];
 return rules.find(([pattern])=>pattern.test(normalized)||pattern.test(header))?.[1]??'ignore';
}

/** RFC4180-style parser. All values stay strings; never coerce identifiers or phone numbers. */
export function parseMetaCsv(text:string){
 text=text.replace(/^\uFEFF/,'');if(text.includes('\uFFFD'))throw new Error('文件编码无法正确识别，请选择原始 CSV 的编码后重试');
 const firstLine=text.split(/\r?\n/,1)[0];
 const counts=[',',';','\t'].map(delimiter=>{let count=0,quoted=false;for(let i=0;i<firstLine.length;i++){if(firstLine[i]==='"')quoted=!quoted;else if(!quoted&&firstLine[i]===delimiter)count++;}return {delimiter,count};});
 const delimiter=counts.sort((a,b)=>b.count-a.count)[0].delimiter;
 const records:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw new Error('CSV 引号格式不正确');quoted=true;}
  else if(c===delimiter){row.push(cell);cell='';closed=false;}
  else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))records.push(row);row=[];cell='';closed=false;}
  else{if(closed&&!/\s/.test(c))throw new Error('CSV 引号后出现非分隔符');if(!closed)cell+=c;}
 }
 if(quoted)throw new Error('CSV 存在未闭合的引号');row.push(cell);if(row.some(v=>v.trim()))records.push(row);
 if(records.length<2)throw new Error('CSV 至少需要表头和一条客户记录');
 const headers=records.shift()!.map(s=>s.trim());
 if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('CSV 表头存在空列名或重复列名，请核对原文件');
 if(headers.length>100||records.length>500)throw new Error('单次最多导入 500 条、100 列，请分批导入');
 if(records.some(r=>r.length!==headers.length))throw new Error('CSV 的列数不一致，请核对分隔符和引号');
 return {headers,rows:records.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i].trim()])))};
}
