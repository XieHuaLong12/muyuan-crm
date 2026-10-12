import { createHmac, randomUUID } from 'node:crypto';
import { safeEqual } from '@/lib/secret';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { Actor, HttpError } from '@/lib/auth';
import { accessible } from './customer-service';
const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','audio/mpeg','audio/ogg','audio/ogg; codecs=opus','audio/mp4','audio/wav','audio/aac','audio/amr','video/mp4','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
export function mediaKind(mimeType:string){return ['image/jpeg','image/png'].includes(mimeType)?'image':['audio/mpeg','audio/mp4','audio/aac','audio/amr','audio/ogg; codecs=opus'].includes(mimeType)?'audio':mimeType==='video/mp4'?'video':'file';}
const storage = () => process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(),'uploads','whatsapp');
function signature(id:string,expires:string){if(!process.env.AUTH_SECRET)throw new HttpError(503,'未配置媒体签名密钥');return createHmac('sha256',process.env.AUTH_SECRET).update(`${id}:${expires}`).digest('hex');}
export function signedMediaUrl(id:string,origin:string){const expires=String(Date.now()+7*86400000);return `${origin}/api/whatsapp/media/${id}?expires=${expires}&token=${signature(id,expires)}`;}
export function verifyMediaToken(id:string,expires:string,token:string){if(!/^\d+$/.test(expires)||Number(expires)<Date.now()||Number(expires)>Date.now()+7*86400000)return false;return safeEqual(token,signature(id,expires));}
export async function uploadMedia(file:File,customerId:string,user:Actor){
  await accessible(customerId,user);
  if(!allowed.has(file.type))throw new HttpError(400,'支持图片、PDF、音视频、Office 文档、ZIP 和文本文件');
  const kind=mediaKind(file.type),maxMB=kind==='image'?5:['audio','video'].includes(kind)?16:20;
  if(!file.size||file.size>maxMB*1024*1024)throw new HttpError(400,`该文件类型须在 1 字节至 ${maxMB} MB 之间`);
  const key=randomUUID();await mkdir(storage(),{recursive:true});
  await writeFile(path.join(storage(),key),Buffer.from(await file.arrayBuffer()),{flag:'wx',mode:0o600});
  try { return await db.mediaAsset.create({data:{customerId,createdBy:user.id,fileName:file.name.replace(/[\r\n/\\]/g,'_').slice(0,180)||'attachment',mimeType:file.type,storageKey:key,size:file.size}}); } catch(error) { await unlink(path.join(storage(),key)).catch(()=>{}); throw error; }
}
export async function readMedia(id:string){const asset=await db.mediaAsset.findUnique({where:{id}});if(!asset)throw new HttpError(404,'文件不存在');return {asset,buffer:await readFile(path.join(storage(),asset.storageKey)).catch(()=>{throw new HttpError(404,'文件已不可用，请重新上传');})};}
