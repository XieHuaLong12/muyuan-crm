import { z } from 'zod';
import { db } from '@/lib/db';
import { Actor,HttpError,hashPassword,verifyPassword } from '@/lib/auth';
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
  // Administrators are listed too so another administrator can reset or disable them; nobody manages their own status here.
  const rows=await db.user.findMany({select:{...accountSelect,_count:{select:{customers:{where:{deletedAt:null,pendingAssignment:false}}}}},orderBy:[{role:'desc'},{isActive:'desc'},{name:'asc'}]});
  return rows.map(row=>({...row,createdAt:row.createdAt.toISOString(),customerCount:row._count.customers,self:row.id===user.id,_count:undefined}));
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
  if(userId===user.id&&v.action!=='name')throw new HttpError(400,'不能在这里停用或重置自己的账号，请使用「修改密码」');
  const passwordHash=v.action==='password'?hashPassword(v.password):undefined;
  return retryTransaction(()=>db.$transaction(async tx=>{
    // Serialize administrator status changes so two admins cannot disable each other at the same time.
    await tx.$queryRaw`SELECT id FROM Setting WHERE id = 'system' FOR UPDATE`;
    const subject=await tx.user.findFirst({where:{id:userId}});
    if(!subject)throw new HttpError(404,'账号不存在');
    if(subject.role==='ADMIN'&&v.action==='status'&&!v.isActive&&await tx.user.count({where:{role:'ADMIN',isActive:true,id:{not:userId}}})===0){
      throw new HttpError(409,'至少需要保留一个启用的管理员账号');
    }
    const changed=await tx.user.updateMany({where:{id:userId,sessionVersion:v.sessionVersion},data:{
      ...(v.action==='status'?{isActive:v.isActive}:{}),...(v.action==='password'?{passwordHash}:{}),...(v.action==='name'?{name:v.name}:{}),sessionVersion:{increment:1},
    }});
    if(changed.count!==1)throw new HttpError(409,'账号已被修改，请刷新后重试');
    await tx.accountAudit.create({data:{subjectId:userId,actorId:user.id,action:v.action==='password'?'PASSWORD_RESET':v.action==='name'?'RENAMED':v.isActive?'ENABLED':'DISABLED'}});
    return tx.user.findUniqueOrThrow({where:{id:userId},select:accountSelect});
  }));
}

const passwordChange=z.object({currentPassword:z.string().min(1,'请填写当前密码').max(128),newPassword:z.string().min(8,'新密码至少 8 位').max(128)})
  .refine(v=>v.currentPassword!==v.newPassword,{message:'新密码不能与当前密码相同',path:['newPassword']});

/** Every user changes their own password. Other sessions end; the caller receives a fresh session version. */
export async function changeOwnPassword(input:unknown,user:Actor){
  const v=passwordChange.parse(input);
  const current=await db.user.findUniqueOrThrow({where:{id:user.id},select:{passwordHash:true,sessionVersion:true}});
  if(!verifyPassword(v.currentPassword,current.passwordHash))throw new HttpError(400,'当前密码不正确');
  const passwordHash=hashPassword(v.newPassword);
  return retryTransaction(()=>db.$transaction(async tx=>{
    const changed=await tx.user.updateMany({where:{id:user.id,sessionVersion:current.sessionVersion,isActive:true},data:{passwordHash,sessionVersion:{increment:1}}});
    if(changed.count!==1)throw new HttpError(409,'账号状态已变化，请重新登录后再试');
    await tx.accountAudit.create({data:{subjectId:user.id,actorId:user.id,action:'PASSWORD_CHANGED'}});
    return tx.user.findUniqueOrThrow({where:{id:user.id},select:{id:true,sessionVersion:true}});
  }));
}
