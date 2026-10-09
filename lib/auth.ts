import { scryptSync,randomBytes,timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import { createSession,parseSession } from './session';
export function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function verifyPassword(password:string,hash:string){const [salt,key]=hash.split(':');if(!salt||!key)return false;const a=Buffer.from(key,'hex'),b=scryptSync(password,salt,64);return a.length===b.length&&timingSafeEqual(a,b);}
function authSecret(){if(!process.env.AUTH_SECRET)throw new Error('AUTH_SECRET 未配置');return process.env.AUTH_SECRET;}
export function token(id:string,version=0){return createSession(id,version,authSecret());}
export async function sessionUser(raw:string){const parsed=parseSession(raw,authSecret());if(!parsed)return null;const user=await db.user.findUnique({where:{id:parsed.id},select:{id:true,name:true,email:true,role:true,isActive:true,sessionVersion:true}});if(!user||!user.isActive||user.sessionVersion!==parsed.version)return null;const {isActive,sessionVersion,...actor}=user;void isActive;void sessionVersion;return actor;}
export async function currentUser(){const raw=(await cookies()).get('crm_session')?.value;return raw?sessionUser(raw):null;}
export async function requireUser(admin=false){const user=await currentUser();if(!user)throw new HttpError(401,'请先登录');if(admin&&user.role!=='ADMIN')throw new HttpError(403,'需要管理员权限');return user;}
export class HttpError extends Error {constructor(public status:number,message:string,public details?:unknown){super(message);}}
export type Actor = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
export function scope(user:Actor){return {deletedAt:null,...(user.role==='ADMIN'?{}:{ownerId:user.id})};}
