import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { HttpError } from '@/lib/auth';
import { normHeader } from '@/lib/meta-import';

const words:Record<string,string>={wholesaler:'批发商',wholesale:'批发商',grossiste:'批发商',importer:'进口商',importateur:'进口商',distributor:'经销商',distributeur:'经销商',retailer:'家具零售',retail:'家具零售',detaillant:'家具零售',brand:'品牌客户',marque:'品牌客户','e commerce':'电商客户',ecommerce:'电商客户',sofa:'沙发',sofas:'沙发',canape:'沙发',canapes:'沙发','compressed sofa':'压缩沙发','canape compresse':'压缩沙发','dining chair':'餐椅','dining table':'餐桌',chair:'椅子',chairs:'椅子',table:'桌子',bed:'床',lit:'床',france:'法国',china:'中国',usa:'美国','united states':'美国','etats unis':'美国',canada:'加拿大',germany:'德国',allemagne:'德国',spain:'西班牙',espagne:'西班牙',italy:'意大利',italie:'意大利',europe:'欧洲',africa:'非洲',afrique:'非洲',asia:'亚洲',asie:'亚洲',price:'价格',prix:'价格',quality:'质量',qualite:'质量','delivery time':'交货时间','delai de livraison':'交货时间','shipping cost':'运费'};
const key=()=>{if(!process.env.AUTH_SECRET)throw new Error('AUTH_SECRET 未配置');return createHash('sha256').update(process.env.AUTH_SECRET).digest();};
function encrypt(value:string){if(!value)return '';const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64')).join('.');}
function decrypt(value:string){if(!value)return '';const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64'));const cipher=createDecipheriv('aes-256-gcm',key(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');}
export async function translationSettings(){const s=await db.translationSetting.findUnique({where:{id:'meta'}});return {endpoint:s?.endpoint??'',keyConfigured:!!s?.encryptedKey};}
export async function saveTranslationSettings(input:unknown){
 const v=z.object({endpoint:z.string().trim().max(500),apiKey:z.string().max(500).optional(),clearKey:z.boolean().optional()}).parse(input);
 if(v.endpoint){let u:URL;try{u=new URL(v.endpoint);}catch{throw new HttpError(400,'翻译服务地址不合法');}if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new HttpError(400,'请使用 HTTPS 地址，或本机 HTTP 翻译服务；地址中不能包含密钥');}
 const old=await db.translationSetting.findUnique({where:{id:'meta'}});
 // An old secret must never be sent to a newly configured endpoint accidentally.
 const encryptedKey=v.clearKey?'':v.apiKey?encrypt(v.apiKey):old?.endpoint===v.endpoint?old.encryptedKey:'';
 await db.translationSetting.upsert({where:{id:'meta'},create:{endpoint:v.endpoint,encryptedKey},update:{endpoint:v.endpoint,encryptedKey}});
 return translationSettings();
}
export async function translator(){
 const setting=await db.translationSetting.findUnique({where:{id:'meta'}});
 const cache=new Map<string,Promise<{text:string;pending:boolean}>>();
 const translate=(value:string,protectedValues:string[]=[])=>{
  if(!value)return Promise.resolve({text:'',pending:false});
  const dictionary=words[normHeader(value)];if(dictionary)return Promise.resolve({text:dictionary,pending:false});
  // Unknown mixed-language sentences remain pending, including Chinese with Latin words.
  if(/[\u3400-\u9fff]/.test(value)&&!/[A-Za-z]/.test(value))return Promise.resolve({text:value,pending:false});
  const cacheKey=JSON.stringify([value,protectedValues]);if(cache.has(cacheKey))return cache.get(cacheKey)!;
  const request=(async()=>{
   if(!setting?.endpoint)return {text:value,pending:true};
   try{
    const protectedParts=[...new Set([...protectedValues.filter(s=>s.length>=2),...(value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{3,}\b/g)??[])])].sort((a,b)=>b.length-a.length);
    const replacements:{token:string;original:string}[]=[];let masked=value;
    for(const part of protectedParts)if(masked.includes(part)){const token=`ZXQKEEP${replacements.length}QXZ`;masked=masked.split(part).join(token);replacements.push({token,original:part});}
    const form=new URLSearchParams({q:masked,source:'auto',target:'zh',format:'text'});if(setting.encryptedKey)form.set('api_key',decrypt(setting.encryptedKey));
    const response=await fetch(setting.endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)return {text:value,pending:true};
    const body=await response.json();let text=typeof body.translatedText==='string'?body.translatedText.trim():'';
    for(const part of replacements){if(text.split(part.token).length!==masked.split(part.token).length)return {text:value,pending:true};text=text.split(part.token).join(part.original);}
    return text&&/[\u3400-\u9fff]/.test(text)&&text.length<10000?{text,pending:false}:{text:value,pending:true};
   }catch{return {text:value,pending:true};}
  })();cache.set(cacheKey,request);return request;
 };
 return {configured:!!setting?.endpoint,translate};
}
