import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,HttpError,hashPassword } from '@/lib/auth';
import { retryTransaction } from '@/lib/transaction-retry';

const accountInput=z.object({name:z.string().trim().min(1,'请填写姓名').max(100),email:z.string().trim().email('邮箱格式不正确').max(191),password:z.string().min(8,'密码至少 8 位').max(128),role:z.enum(['ADMIN','SALES']).default('SALES')});
const accountPatch=z.discriminatedUnion('action',[
  z.object({action:z.literal('status'),isActive:z.boolean(),sessionVersion:z.number().int().min(0)}),
  z.object({action:z.literal('password'),password:z.string().min(8,'密码至少 8 位').max(128),sessionVersion:z.number().int().min(0)}),
  z.object({action:z.literal('name'),name:z.string().trim().min(1).max(100),sessionVersion:z.number().int().min(0)}),
]);
export function requireManager(user:Actor){if(user.role!=='ADMIN')throw new HttpError(403,'需要管理员权限');}
const accountSelect={id:true,name:true,email:true,role:true,isActive:true,sessionVersion:true,createdAt:true} as const;

export async function salesAccounts(user:Actor){
  requireManager(user);
  const rows=await db.user.findMany({where:{role:'SALES'},select:{...accountSelect,_count:{select:{customers:{where:{deletedAt:null}}}}},orderBy:[{isActive:'desc'},{name:'asc'}]});
  return rows.map(row=>({...row,createdAt:row.createdAt.toISOString(),customerCount:row._count.customers,_count:undefined}));
}
export async function createUserAccount(input:unknown,user:Actor){
  requireManager(user);const v=accountInput.parse(input),email=v.email.toLowerCase();
  if(await db.user.findUnique({where:{email}}))throw new HttpError(409,'邮箱已存在');
  const passwordHash=hashPassword(v.password);
  return retryTransaction(()=>db.$transaction(async tx=>{
    const created=await tx.user.create({data:{name:v.name,email,role:v.role,passwordHash},select:accountSelect});
    await tx.accountAudit.create({data:{subjectId:created.id,actorId:user.id,action:'CREATED'}});
    return created;
  }));
}
export async function updateSalesAccount(id:unknown,input:unknown,user:Actor){
  requireManager(user);const userId=z.string().min(1).max(191).parse(id),v=accountPatch.parse(input);
  const passwordHash=v.action==='password'?hashPassword(v.password):undefined;
  return retryTransaction(()=>db.$transaction(async tx=>{
    const subject=await tx.user.findFirst({where:{id:userId,role:'SALES'}});
    if(!subject)throw new HttpError(404,'销售账号不存在');
    const changed=await tx.user.updateMany({where:{id:userId,role:'SALES',sessionVersion:v.sessionVersion},data:{
      ...(v.action==='status'?{isActive:v.isActive}:{}),...(v.action==='password'?{passwordHash}:{}),...(v.action==='name'?{name:v.name}:{}),sessionVersion:{increment:1},
    }});
    if(changed.count!==1)throw new HttpError(409,'账号已被修改，请刷新后重试');
    await tx.accountAudit.create({data:{subjectId:userId,actorId:user.id,action:v.action==='password'?'PASSWORD_RESET':v.action==='name'?'RENAMED':v.isActive?'ENABLED':'DISABLED'}});
    return tx.user.findUniqueOrThrow({where:{id:userId},select:accountSelect});
  }));
}
