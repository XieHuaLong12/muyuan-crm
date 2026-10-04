import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../lib/db';
import {previewMeta,commitMeta} from '../services/meta-import-service';
import {deleteTestCustomers} from './identity-test-cleanup';

test('500-row CSV commits and repeat lead batches preserve 500 customer identities and 1000 source records',async()=>{
  const admin=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});const marker=randomUUID();const tokens:string[]=[];const ids:string[]=[];
  const at=new Date(Date.now()-2*86400000).toISOString();
  const csv=(batch:string)=>'id,created_time,full_name,phone_number,platform,ad_id\n'+Array.from({length:500},(_,i)=>`${marker}-${batch}-${i},${at},Bulk ${marker} ${i},+4474${String(i).padStart(8,'0')},fb,bulk-ad`).join('\n');
  try{
    const first=await previewMeta({filename:'Bulk.csv',text:csv('first')},admin);tokens.push(first.token);assert.equal(first.rows.filter(r=>r.status==='NEW').length,500);
    const saved=await commitMeta({token:first.token,rows:first.rows.map(r=>r.row),confirmed:true},admin);ids.push(...saved.customerIds);assert.equal(saved.created,500);
    assert.deepEqual(await commitMeta({token:first.token,rows:first.rows.map(r=>r.row),confirmed:true},admin),saved,'retry returns all 500 IDs from the durable JSON result');
    const run=await db.metaImportRun.findUniqueOrThrow({where:{id:first.token}});assert.ok(run.result.length<=191);assert.ok(run.resultPayload);
    const legacyToken=randomUUID();tokens.push(legacyToken);const legacy={created:1,repeated:0,skipped:0,customerIds:[ids[0]]};
    await db.metaImportRun.create({data:{id:legacyToken,userId:admin.id,result:JSON.stringify(legacy)}});
    assert.deepEqual(await commitMeta({token:legacyToken,rows:[2],confirmed:true},admin),legacy,'pre-upgrade import results remain replayable');
    const repeat=await previewMeta({filename:'Repeat.csv',text:csv('repeat')},admin);tokens.push(repeat.token);assert.equal(repeat.rows.filter(r=>r.status==='REPEAT').length,500);
    const linked=await commitMeta({token:repeat.token,rows:repeat.rows.map(r=>r.row),confirmed:true},admin);assert.equal(linked.created,0);assert.equal(linked.repeated,500);assert.deepEqual(new Set(linked.customerIds),new Set(ids));
    assert.equal(await db.customer.count({where:{id:{in:ids}}}),500);assert.equal(await db.customerLeadAttribution.count({where:{customerId:{in:ids}}}),1000);
    assert.equal((await previewMeta({filename:'Again.csv',text:csv('first')},admin)).rows.filter(r=>r.status==='IMPORTED').length,500);
  }finally{
    await deleteTestCustomers({where:{name:{startsWith:`Bulk ${marker} `}}});await db.metaImportRun.deleteMany({where:{id:{in:tokens}}});
  }
});
