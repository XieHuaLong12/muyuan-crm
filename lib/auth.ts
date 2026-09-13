import { scryptSync,randomBytes,timingSafeEqual,createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
export function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function verifyPassword(password:string,hash:string){const [salt,key]=hash.split(':');if(!salt||!key)return false;const a=Buffer.from(key,'hex'),b=scryptSync(password,salt,64);return a.length===b.length&&timingSafeEqual(a,b);}
function sign(value:string){if(!process.env.AUTH_SECRET)throw new Error('AUTH_SECRET 未配置');return createHmac('sha256',process.env.AUTH_SECRET).update(value).digest('hex');}
export function token(id:string){const value=`${id}.${Date.now()+7*86400000}`;return `${value}.${sign(value)}`;}
export async function currentUser(){const raw=(await cookies()).get('crm_session')?.value;if(!raw)return null;const [id,expiry,sig]=raw.split('.');if(!id||!expiry||!sig||Number(expiry)<Date.now())return null;const expected=sign(`${id}.${expiry}`);if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;return db.user.findUnique({where:{id},select:{id:true,name:true,email:true,role:true}});}
export async function requireUser(admin=false){const user=await currentUser();if(!user)throw new HttpError(401,'请先登录');if(admin&&user.role!=='ADMIN')throw new HttpError(403,'需要管理员权限');return user;}
export class HttpError extends Error {constructor(public status:number,message:string,public details?:unknown){super(message);}}
export type Actor = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
export function scope(user:Actor){return {deletedAt:null,...(user.role==='ADMIN'?{}:{ownerId:user.id})};}
