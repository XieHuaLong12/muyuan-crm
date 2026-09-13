import assert from 'node:assert/strict';
import { db } from '../lib/db';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:3001';let cookie='';const ids:string[]=[],runs:string[]=[];
async function call(path:string,method='GET',body?:unknown){const r=await fetch(`${base}/api/${path}`,{method,headers:{cookie,Origin:base,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};}
async function main(){
 assert.equal((await call('meta-import/translation')).status,401);
 const login=await call('auth/login','POST',{email:'admin@example.com',password:process.env.SEED_ADMIN_PASSWORD});assert.equal(login.status,200);cookie=login.cookie!.split(';')[0];
 const text=`id,created_time,full_name,email,platform,product\nhttp-${Date.now()},2024-02-29,HTTP Import Test,http-import@example.test,ig,sofa`;
 const before=await db.customer.count();const p=await call('meta-import/preview','POST',{filename:'test.csv',text});assert.equal(p.status,200,JSON.stringify(p.body));runs.push(p.body.data.token);
 assert.equal(await db.customer.count(),before);assert.equal(p.body.data.rows[0].status,'NEW');
 assert.equal((await call('meta-import/commit','POST',{token:p.body.data.token,rows:[2],confirmed:false})).status,400);
 const result=await call('meta-import/commit','POST',{token:p.body.data.token,rows:[2],confirmed:true});assert.equal(result.status,200,JSON.stringify(result.body));ids.push(...result.body.data.customerIds);
 const detail=await call(`customers/${ids[0]}`);assert.equal(detail.body.data.submissions.length,1);assert.equal(detail.body.data.source,'INSTAGRAM');assert.equal(detail.body.data.quantity,null);
 assert.equal((await call('meta-import/preview','POST',{filename:'renamed.csv',text})).body.data.rows[0].status,'IMPORTED');
 assert.equal((await call('meta-import/commit','POST',{token:p.body.data.token,rows:[2],confirmed:true})).body.data.created,1);assert.equal(await db.customer.count(),before+1);
 const sales=await call('auth/login','POST',{email:'sales@example.com',password:process.env.SEED_ADMIN_PASSWORD});cookie=sales.cookie!.split(';')[0];assert.equal((await call('meta-import/preview','POST',{filename:'test.csv',text})).status,403);
 console.log('PASS: HTTP authentication, preview without writes, explicit confirmation, import, repeat skip, history and role isolation.');
}
main().finally(async()=>{await db.leadSubmission.deleteMany({where:{customerId:{in:ids}}});await db.stageHistory.deleteMany({where:{customerId:{in:ids}}});await db.customer.deleteMany({where:{id:{in:ids}}});await db.metaImportRun.deleteMany({where:{id:{in:runs}}});await db.$disconnect();});
