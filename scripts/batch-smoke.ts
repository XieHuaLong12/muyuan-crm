import assert from 'node:assert/strict';
import { db } from '../lib/db';
const base='http://127.0.0.1:3000';
let cookie='';
const created:string[]=[];
async function call(path:string,method='GET',body?:unknown){const r=await fetch(`${base}/api/${path}`,{method,headers:{cookie,Origin:base,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};}
async function main(){
  assert.equal((await call('customers/trash')).status,401);
  const login=await call('auth/login','POST',{email:'admin@example.com',password:process.env.SEED_ADMIN_PASSWORD});assert.equal(login.status,200);cookie=login.cookie!.split(';')[0];
  const boot=(await call('bootstrap')).body.data;
  for(let i=0;i<2;i++){const result=await call('customers','POST',{name:`HTTP批量验收${i}`,ownerId:boot.user.id});assert.equal(result.status,201);created.push(result.body.data.id);}
  const before=await db.customer.count({where:{deletedAt:null}});
  const won=await db.customer.findFirstOrThrow({where:{deletedAt:null,deals:{some:{}}}});
  assert.equal((await call('customers/batch-delete','POST',{ids:[created[0],won.id]})).status,409);
  assert.equal(await db.customer.count({where:{deletedAt:null}}),before);
  const removed=await call('customers/batch-delete','POST',{ids:created});assert.equal(removed.status,200);assert.equal(removed.body.data.count,2);
  const trash=(await call('customers/trash')).body.data as {id:string}[];assert.ok(created.every(id=>trash.some(c=>c.id===id)));
  assert.equal((await call('customers/batch-restore','POST',{ids:created})).body.data.count,2);
  assert.equal(await db.customer.count({where:{deletedAt:null}}),before);
  const sales=await call('auth/login','POST',{email:'sales@example.com',password:process.env.SEED_ADMIN_PASSWORD});cookie=sales.cookie!.split(';')[0];
  for(const action of ['batch-delete','batch-restore'])assert.equal((await call(`customers/${action}`,'POST',{ids:created})).status,403);
  assert.equal((await call('customers/trash')).status,403);
  console.log('PASS: 批量删除、恢复、回收站、成交客户整批保护和角色权限 HTTP 验收通过。');
}
main().finally(async()=>{await db.stageHistory.deleteMany({where:{customerId:{in:created}}});await db.customer.deleteMany({where:{id:{in:created}}});await db.$disconnect();});
