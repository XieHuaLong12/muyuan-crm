import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { safeEqual } from '@/lib/secret';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { graphVersion } from '@/lib/meta-graph';
import { accessible } from './customer-service';
const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','audio/mpeg','audio/ogg','audio/ogg; codecs=opus','audio/mp4','audio/wav','audio/aac','audio/amr','video/mp4','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
export function mediaKind(mimeType:string){return ['image/jpeg','image/png'].includes(mimeType)?'image':['audio/mpeg','audio/mp4','audio/aac','audio/amr','audio/ogg; codecs=opus'].includes(mimeType)?'audio':mimeType==='video/mp4'?'video':'file';}
const storage = () => process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(),'uploads','whatsapp');
function signature(id:string,expires:string){if(!process.env.AUTH_SECRET)throw new HttpError(503,'未配置媒体签名密钥');return createHmac('sha256',process.env.AUTH_SECRET).update(`${id}:${expires}`).digest('hex');}
export function signedMediaUrl(id:string,origin:string){const expires=String(Date.now()+7*86400000);return `${origin}/api/whatsapp/media/${id}?expires=${expires}&token=${signature(id,expires)}`;}
export function verifyMediaToken(id:string,expires:string,token:string){if(!/^\d+$/.test(expires)||Number(expires)<Date.now()||Number(expires)>Date.now()+7*86400000)return false;return safeEqual(token,signature(id,expires));}
const safeFileName=(name:string)=>name.replace(/[\r\n/\\]/g,'_').slice(0,180)||'attachment';
/** Writes the bytes under a fresh key and records the asset; the file is removed again if the record cannot be saved. */
async function storeMedia(input:{customerId:string;createdBy:string;fileName:string;mimeType:string;buffer:Buffer}){
  const key=randomUUID();await mkdir(storage(),{recursive:true});
  await writeFile(path.join(storage(),key),input.buffer,{flag:'wx',mode:0o600});
  try { return await db.mediaAsset.create({data:{customerId:input.customerId,createdBy:input.createdBy,fileName:safeFileName(input.fileName),mimeType:input.mimeType,storageKey:key,size:input.buffer.length}}); } catch(error) { await unlink(path.join(storage(),key)).catch(()=>{}); throw error; }
}
async function discardMedia(asset:{id:string;storageKey:string}){await db.mediaAsset.delete({where:{id:asset.id}}).catch(()=>{});await unlink(path.join(storage(),asset.storageKey)).catch(()=>{});}
export async function uploadMedia(file:File,customerId:string,user:Actor){
  await accessible(customerId,user);
  if(!allowed.has(file.type))throw new HttpError(400,'支持图片、PDF、音视频、Office 文档、ZIP 和文本文件');
  const kind=mediaKind(file.type),maxMB=kind==='image'?5:['audio','video'].includes(kind)?16:20;
  if(!file.size||file.size>maxMB*1024*1024)throw new HttpError(400,`该文件类型须在 1 字节至 ${maxMB} MB 之间`);
  return storeMedia({customerId,createdBy:user.id,fileName:file.name,mimeType:file.type,buffer:Buffer.from(await file.arrayBuffer())});
}
export async function readMedia(id:string){const asset=await db.mediaAsset.findUnique({where:{id}});if(!asset)throw new HttpError(404,'文件不存在');return {asset,buffer:await readFile(path.join(storage(),asset.storageKey)).catch(()=>{throw new HttpError(404,'文件已不可用，请重新上传');})};}

/** Types a browser may render in place; everything else (SVG, HTML, Office…) is only offered as a download. */
const INLINE_TYPES=/^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/(mp4|3gpp))(;.*)?$/;
export const inlineMedia=(mimeType:string)=>INLINE_TYPES.test(mimeType);

// ── Inbound media ──
// Provider links expire (Gupshup gives a urlExpiry; Meta's need a token), so customer media is copied into
// our own storage once and then served like any uploaded attachment.
export const MEDIA_MESSAGE_TYPES=new Set(['IMAGE','VIDEO','AUDIO','VOICE','DOCUMENT','FILE','STICKER']);
const LIVE_SOURCES=new Set(['gupshup','cloud_api']);
const INBOUND_MAX_BYTES=32*1024*1024;
// Only the providers' own media hosts are fetched; a webhook can never make the server request an arbitrary address.
const TRUSTED_MEDIA_HOSTS=[/(^|\.)gupshup\.io$/i,/(^|\.)fbsbx\.com$/i,/(^|\.)fbcdn\.net$/i,/(^|\.)whatsapp\.net$/i,/(^|\.)facebook\.com$/i];
const archived=(mediaUrl:string|null)=>!!mediaUrl&&mediaUrl.startsWith('/api/whatsapp/media/');
const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/3gpp':'3gp',
  'audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp4':'m4a','audio/aac':'aac','audio/amr':'amr','application/pdf':'pdf'};

function cleanMime(value:unknown){
  const mime=typeof value==='string'?value.trim().toLowerCase().slice(0,100):'';
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+(;\s*[a-z0-9.+-]+=[a-z0-9.+"-]+)*$/.test(mime)?mime:'';
}
const record=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():undefined;

type MediaMessage={id:string;source:string;direction:string;messageType:string;mediaUrl:string|null;mimeType:string|null;fileName:string|null;raw:string};
/** Where the provider keeps this message's file: Gupshup V2 `payload.url`, V3/Cloud `<type>.url` or a Cloud media id. */
export function inboundMediaRef(message:MediaMessage){
  if(message.direction!=='INBOUND'||!LIVE_SOURCES.has(message.source)||!MEDIA_MESSAGE_TYPES.has(message.messageType.toUpperCase()))return null;
  let raw:Record<string,unknown>|null=null;
  try{raw=record(JSON.parse(message.raw));}catch{raw=null;}
  const v2=record(raw?.payload),type=typeof raw?.type==='string'?raw.type:'',cloud=record(raw?.[type]);
  const url=text(message.mediaUrl?.startsWith('https://')?message.mediaUrl:undefined)||text(v2?.url)||text(cloud?.url)||text(cloud?.link);
  const mediaId=text(cloud?.id)||text(v2?.mediaId);
  const mimeType=cleanMime(message.mimeType)||cleanMime(v2?.contentType)||cleanMime(v2?.['content-type'])||cleanMime(cloud?.mime_type);
  const fileName=message.fileName||text(v2?.name)||text(v2?.filename)||text(cloud?.filename);
  return url||mediaId?{url,mediaId,mimeType,fileName}:null;
}

async function readCapped(response:Response){
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>INBOUND_MAX_BYTES)throw new HttpError(413,'客户发送的文件超过 32 MB，请在手机 WhatsApp 中查看');
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks:Buffer[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>INBOUND_MAX_BYTES){await reader.cancel().catch(()=>{});throw new HttpError(413,'客户发送的文件超过 32 MB，请在手机 WhatsApp 中查看');}
    chunks.push(Buffer.from(value));}
  return Buffer.concat(chunks);
}
function trustedUrl(value:string){
  let url:URL;try{url=new URL(value);}catch{return null;}
  return url.protocol==='https:'&&!url.username&&!url.password&&TRUSTED_MEDIA_HOSTS.some(host=>host.test(url.hostname))?url:null;
}
/** Redirects are followed by hand so every hop stays on HTTPS and on a public host name (never an IP or localhost). */
async function download(url:URL,headers:Record<string,string>={}){
  let current=url;
  for(let hop=0;hop<4;hop++){
    let response:Response;
    try{response=await fetch(current,{headers:hop?{}:headers,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30_000)});}
    catch{throw new HttpError(502,'暂时无法连接 WhatsApp 媒体服务器，请稍后重试');}
    const location=response.status>=300&&response.status<400?response.headers.get('location'):null;
    if(!location)return response;
    let next:URL;try{next=new URL(location,current);}catch{throw new HttpError(502,'媒体文件地址不安全，已拒绝下载');}
    if(next.protocol!=='https:'||next.username||next.password||/^(localhost|\[.*\]|[\d.]+)$/i.test(next.hostname))throw new HttpError(502,'媒体文件地址不安全，已拒绝下载');
    current=next;
  }
  throw new HttpError(502,'媒体文件重定向次数过多，已停止下载');
}
async function cloudAccessToken(){
  const integration=await db.whatsAppIntegration.findUnique({where:{id:'primary'},select:{status:true,encryptedAccessToken:true}});
  if(integration?.status!=='CONNECTED'||!integration.encryptedAccessToken)return '';
  const {decryptWhatsAppAccessToken}=await import('./whatsapp-connect-service');
  try{return decryptWhatsAppAccessToken(integration.encryptedAccessToken);}catch{return '';}
}
/** One download attempt as shown in the diagnostics: host, how it authenticated, what came back. Never the full link or key. */
export type MediaAttempt={host:string;auth:'none'|'apikey'|'authorization'|'bearer';status:number|'network'|'refused';note?:string};
class MediaDownloadError extends HttpError{constructor(status:number,message:string,public attempts:MediaAttempt[]){super(status,message,{attempts});}}
const isGupshup=(url:URL)=>/(^|\.)gupshup\.io$/i.test(url.hostname);

/** Downloads one link; a JSON answer that only points at the file (some Gupshup links do) is followed once. */
async function tryDownload(url:URL,headers:Record<string,string>,auth:MediaAttempt['auth'],attempts:MediaAttempt[],followJson=true):Promise<{buffer:Buffer;mimeType:string}|null>{
  let response:Response;
  try{response=await download(url,headers);}
  catch(error){attempts.push({host:url.hostname,auth,status:error instanceof HttpError&&error.status===502&&/不安全|重定向/.test(error.message)?'refused':'network',note:error instanceof Error?error.message:undefined});return null;}
  attempts.push({host:url.hostname,auth,status:response.status});
  if(!response.ok)return null;
  const mimeType=cleanMime(response.headers.get('content-type'));
  if(followJson&&mimeType.startsWith('application/json')){
    const body=record(await response.json().catch(()=>null));
    const next=text(body?.url)||text(body?.link)||text(body?.downloadUrl)||text(record(body?.media)?.url);
    const target=next?trustedUrl(next):null;
    if(!target){attempts[attempts.length-1].note='返回的是数据而不是文件';return null;}
    return tryDownload(target,headers,auth,attempts,false);
  }
  return {buffer:await readCapped(response),mimeType};
}

async function fetchProviderMedia(message:MediaMessage,ref:NonNullable<ReturnType<typeof inboundMediaRef>>){
  const attempts:MediaAttempt[]=[];
  const fail=(reason='媒体文件已过期或无法从 WhatsApp 下载，请在手机 WhatsApp 中查看')=>new MediaDownloadError(404,reason,attempts);
  const apiKey=process.env.GUPSHUP_API_KEY?.trim();
  // Gupshup links are usually public until urlExpiry; some apps want the app key, as a header named either way.
  const gupshupAuth=(url:URL):[Record<string,string>,MediaAttempt['auth']][]=>[[{},'none'],
    ...(apiKey&&isGupshup(url)?[[{apikey:apiKey},'apikey'],[{Authorization:apiKey},'authorization']] as [Record<string,string>,MediaAttempt['auth']][]:[])];
  if(ref.url){
    const url=trustedUrl(ref.url);
    if(!url){attempts.push({host:(()=>{try{return new URL(ref.url!).hostname;}catch{return '无效链接';}})(),auth:'none',status:'refused'});throw new MediaDownloadError(400,'媒体文件不在 WhatsApp 服务商域名下，已拒绝下载',attempts);}
    for(const [headers,auth] of gupshupAuth(url)){
      const file=await tryDownload(url,headers,auth,attempts);
      if(file)return file;
      if(attempts.at(-1)?.status==='refused')break;
    }
  }
  if(message.source==='gupshup'&&ref.mediaId&&/^[\w.-]{1,191}$/.test(ref.mediaId)&&apiKey){
    // Only a media id (no link): Gupshup's media download for the app, by app name and by app id.
    const appName=process.env.GUPSHUP_APP_NAME?.trim(),appId=process.env.GUPSHUP_APP_ID?.trim();
    const links=[...(appName?[`https://api.gupshup.io/sm/api/wamedia/${encodeURIComponent(appName)}/${encodeURIComponent(ref.mediaId)}`]:[]),
      ...(appId?[`https://filemanager.gupshup.io/wa/${encodeURIComponent(appId)}/wa/media/${encodeURIComponent(ref.mediaId)}?download=true`]:[])];
    for(const link of links)for(const [headers,auth] of gupshupAuth(new URL(link)).slice(1)){
      const file=await tryDownload(new URL(link),headers,auth,attempts);
      if(file)return file;
    }
  }
  if(message.source==='cloud_api'&&ref.mediaId&&/^[\w-]{1,128}$/.test(ref.mediaId)){
    const token=await cloudAccessToken();if(!token)throw fail('Cloud API 未连接，无法下载这条消息的文件');
    const meta=await fetch(`https://graph.facebook.com/${graphVersion()}/${ref.mediaId}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(20_000)}).catch(()=>null);
    attempts.push({host:'graph.facebook.com',auth:'bearer',status:meta?.status??'network'});
    const body=(meta?await meta.json().catch(()=>({})):{}) as {url?:string;mime_type?:string};
    const url=meta?.ok&&body.url?trustedUrl(body.url):null;
    const file=url?await tryDownload(url,{Authorization:`Bearer ${token}`},'bearer',attempts):null;
    if(file)return {buffer:file.buffer,mimeType:cleanMime(body.mime_type)||file.mimeType};
  }
  if(!attempts.length)throw fail('这条消息没有可下载的文件链接');
  const statuses=attempts.map(a=>a.status);
  if(statuses.includes('refused'))throw new MediaDownloadError(502,'媒体文件地址不安全，已拒绝下载',attempts);
  throw fail(statuses.every(s=>s==='network')?'暂时无法连接 WhatsApp 媒体服务器，请稍后重试'
    :statuses.some(s=>s===401||s===403)?'WhatsApp 媒体服务器拒绝下载（需要授权或链接已过期），请在手机 WhatsApp 中查看'
    :statuses.some(s=>s===404||s===410)?'媒体文件已过期，请在手机 WhatsApp 中查看'
    :'媒体文件无法从 WhatsApp 下载，请在手机 WhatsApp 中查看');
}

/** Failed downloads are kept as jobs so the WhatsApp settings page can say which step broke. */
async function recordMediaFailure(messageId:string,error:unknown){
  const attempts=error instanceof MediaDownloadError?error.attempts:[];
  await db.syncJob.create({data:{provider:'GUPSHUP',jobType:'MEDIA_DOWNLOAD',status:'FAILED',completedAt:new Date(),failed:1,
    error:(error instanceof HttpError?error.message:'保存文件失败').slice(0,500),detail:{messageId,attempts}}}).catch(()=>{});
}

/** Copies a received photo, video, voice note or document into storage; returns the asset id (idempotent). */
export async function archiveInboundMedia(messageId:string){
  const message=await db.whatsAppMessage.findUnique({where:{id:messageId},select:{id:true,customerId:true,source:true,direction:true,messageType:true,mediaUrl:true,mimeType:true,fileName:true,raw:true}});
  if(!message)throw new HttpError(404,'消息不存在');
  if(archived(message.mediaUrl))return message.mediaUrl!.slice('/api/whatsapp/media/'.length);
  const ref=inboundMediaRef(message);
  if(!ref)throw new HttpError(404,'这条消息没有可下载的文件');
  let file:Awaited<ReturnType<typeof fetchProviderMedia>>;
  try{file=await fetchProviderMedia(message,ref);}
  catch(error){await recordMediaFailure(message.id,error);throw error;}
  if(!file.buffer.length){await recordMediaFailure(message.id,new HttpError(404,'媒体文件为空'));throw new HttpError(404,'媒体文件为空，请在手机 WhatsApp 中查看');}
  const mimeType=ref.mimeType||file.mimeType||'application/octet-stream',bare=mimeType.split(';')[0];
  const fileName=ref.fileName||`${message.messageType.toLowerCase()}-${message.id}.${extensions[bare]||'bin'}`;
  const asset=await storeMedia({customerId:message.customerId,createdBy:'SYSTEM',fileName,mimeType,buffer:file.buffer});
  const saved=await db.whatsAppMessage.updateMany({where:{id:message.id,mediaUrl:message.mediaUrl},data:{mediaUrl:`/api/whatsapp/media/${asset.id}`,mimeType,fileName:asset.fileName}});
  if(saved.count)return asset.id;
  // Another request archived the same file first: keep theirs.
  await discardMedia(asset);
  const winner=await db.whatsAppMessage.findUniqueOrThrow({where:{id:message.id},select:{mediaUrl:true}});
  if(!archived(winner.mediaUrl))throw new HttpError(409,'媒体文件正在保存，请稍后重试');
  return winner.mediaUrl!.slice('/api/whatsapp/media/'.length);
}

/** Opens a message's file for someone allowed to see the customer, copying it from the provider on first view. */
export async function messageMediaAsset(messageId:string,user:Actor){
  z.string().trim().min(1).max(191).parse(messageId);
  const message=await db.whatsAppMessage.findUnique({where:{id:messageId},select:{customerId:true}});
  if(!message)throw new HttpError(404,'消息不存在');
  await accessible(message.customerId,user);
  return archiveInboundMedia(messageId);
}

/** Background copy after a webhook; failures are retried when someone opens the message. */
export async function archiveInboundMediaQuietly(messageIds:string[]){
  for(const id of messageIds){
    try{await archiveInboundMedia(id);}
    catch(error){console.error('[WhatsApp Media] ARCHIVE_DEFERRED',error instanceof HttpError?error.status:'NETWORK');}
  }
}

/** The link the chat shows for a message's file: archived copy, on-demand copy for live media, or none. */
export function messageMediaHref(message:Pick<MediaMessage,'id'|'source'|'direction'|'messageType'|'mediaUrl'>){
  if(archived(message.mediaUrl))return message.mediaUrl;
  if(message.direction==='INBOUND'&&LIVE_SOURCES.has(message.source)&&MEDIA_MESSAGE_TYPES.has(message.messageType.toUpperCase()))return `/api/whatsapp/messages/${message.id}/media`;
  return null;
}
