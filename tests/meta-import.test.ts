import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { parseMetaCsv,identifyHeader } from '../lib/meta-import';
import { previewMeta,commitMeta,metaDate } from '../services/meta-import-service';
import { saveTranslationSettings,translationSettings,translator } from '../services/meta-translation-service';
import { dashboard } from '../services/dashboard-service';

test('Meta CSV：多分隔符、BOM、引号/换行、字符串 ID、法文问题及严格日期',()=>{
 const a=parseMetaCsv('\uFEFFid,full_name,phone_number,comments\r\n1234567890123456789,"Jean, Martin",0033612345678,"Bonjour\n""test"""\r\n');
 assert.equal(a.rows[0].id,'1234567890123456789');assert.equal(a.rows[0].phone_number,'0033612345678');assert.equal(a.rows[0].comments,'Bonjour\n"test"');
 assert.equal(parseMetaCsv('nom_complet;email\nJean;jean@example.test').rows[0].nom_complet,'Jean');
 assert.equal(parseMetaCsv('full_name\tphone_number\nJean\t+33123456789').rows.length,1);
 assert.throws(()=>parseMetaCsv('name,name\na,b'),/重复/);assert.throws(()=>parseMetaCsv('name,email\n"bad'),/引号/);assert.throws(()=>parseMetaCsv('name,email\na,b,c'),/列数/);
 assert.equal(identifyHeader('Quel produit vous intéresse ?'),'productInterest');assert.equal(identifyHeader('ad_name'),'adName');assert.equal(identifyHeader('未知问题'),'ignore');assert.equal(identifyHeader('姓名'),'name');
 assert.equal(metaDate('2024-12-31T18:00:00+0000','Asia/Shanghai'),'2025-01-01');assert.throws(()=>metaDate('01/02/2025','Asia/Shanghai'));
});

test('智能导入：预览零写入、幂等、重复留资、疑似重复、保留原数据、翻译待处理',async()=>{
 const user=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}}),ids:string[]=[],runIds:string[]=[];
 const prefix=`meta-test-${Date.now()}`;
 const beforeCount=await db.customer.count();const beforeSub=await db.leadSubmission.count();
 const make=(id:string,name='Jean Test',phone='+33987654321',product='sofa',quantity='20')=>`id,created_time,full_name,phone_number,email,platform,ad_name,customer_type,product,product_model,quantity,sales_market,concerns\n${id},2024-12-31T10:00:00+0000,${name},${phone},,fb,Original Ad,grossiste,${product},X-100,${quantity},France,quality`;
 const preview=async(text:string,extra:object={})=>{const p=await previewMeta({filename:'Meta.csv',text,...extra},user);runIds.push(p.token);return p;};
 const commit=async(p:Awaited<ReturnType<typeof preview>>,rows?:number[],allowPendingTranslation=false)=>{const r=await commitMeta({token:p.token,rows:rows??p.rows.filter(r=>['NEW','REPEAT'].includes(r.status)).map(r=>r.row),confirmed:true,allowPendingTranslation},user);ids.push(...r.customerIds.filter((id:string)=>!ids.includes(id)));return r;};
 try{
  await assert.rejects(previewMeta({filename:'x',text:make(prefix)}, {...user,role:'SALES'}),/管理员/);
  const decBefore=await dashboard(user,'MONTH','2024-12-01','CNY');
  const p=await preview(make(prefix));assert.equal(p.rows[0].status,'NEW');assert.equal(p.rows[0].values.productInterest,'沙发');assert.equal(p.rows[0].values.customerType,'批发商');assert.equal(p.rows[0].values.name,'Jean Test');assert.equal(p.rows[0].values.productModel,'X-100');assert.equal(p.rows[0].values.adName,'Original Ad');assert.deepEqual(p.rows[0].pending,[]);
  assert.equal(await db.customer.count(),beforeCount);assert.equal(await db.leadSubmission.count(),beforeSub);
  const result=await commit(p);assert.equal(result.created,1);const customer=await db.customer.findUniqueOrThrow({where:{id:result.customerIds[0]}});
  assert.equal(customer.quantity,20);assert.equal(customer.source,'FACEBOOK');assert.equal((await dashboard(user,'MONTH','2024-12-01','CNY')).current.inquiries,decBefore.current.inquiries+1);
  assert.deepEqual(await commit(p),result);assert.equal(await db.leadSubmission.count({where:{customerId:customer.id}}),1);
  const duplicated=await preview(make(prefix));assert.equal(duplicated.rows[0].status,'IMPORTED');
  const repeat=await preview(make(prefix+'-2','Jean Test','0033987654321','chair','40'));assert.equal(repeat.rows[0].status,'REPEAT');assert.equal(repeat.rows[0].ordinal,2);
  assert.equal((await commit(repeat)).repeated,1);assert.deepEqual(await db.customer.findUniqueOrThrow({where:{id:customer.id}}),customer);
  assert.equal(await db.customer.count(),beforeCount+1);assert.equal((await dashboard(user,'MONTH','2024-12-01','CNY')).current.inquiries,decBefore.current.inquiries+1);
  const third=await preview(make(prefix+'-3'));assert.equal(third.rows[0].ordinal,3);await commit(third);
  const changedOriginal=await preview(make(prefix,'Different spelling','+33111111111'));assert.equal(changedOriginal.rows[0].status,'IMPORTED');
  const reordered=parseMetaCsv(make(prefix+'-noid')).rows[0];delete reordered.id;
  const noId=Object.keys(reordered).join(',')+'\n'+Object.values(reordered).join(',');const noIdPreview=await preview(noId);await commit(noIdPreview);
  const reverse=Object.entries(reordered).reverse();assert.equal((await preview(reverse.map(([k])=>k).join(',')+'\n'+reverse.map(([,v])=>v).join(','))).rows[0].status,'IMPORTED');
  const unknown=await preview(make(prefix+'-unknown','Unknown Answer','+441234567890','Besoin de coussins personnalisés',''));assert.ok(unknown.rows[0].pending.includes('意向产品'));
  await assert.rejects(commit(unknown),/未翻译/);await commit(unknown,undefined,true);
  assert.equal((await db.customer.findUniqueOrThrow({where:{id:ids.at(-1)}})).quantity,null);
  const ambiguousCustomer=await db.customer.create({data:{name:'Other same phone',ownerId:user.id,phone:'+33987654321'}});ids.push(ambiguousCustomer.id);
  const suspect=await preview(make(prefix+'-conflict'));assert.equal(suspect.rows[0].status,'SUSPECT');await assert.rejects(commitMeta({token:suspect.token,rows:[2],confirmed:true},user),/只能确认/);
  const resolved=await preview(make(prefix+'-conflict'),{decisions:{2:{action:'link',customerId:customer.id}}});assert.equal(resolved.rows[0].status,'REPEAT');await commit(resolved);
  const bad=await preview(make(prefix+'-bad').replace('2024-12-31T10:00:00+0000','2099-12-31'));assert.equal(bad.rows[0].status,'INVALID');
  const stale=await preview(make(prefix+'-stale','Stale','+492221234567'));
  const conflicting=await db.customer.create({data:{name:'Added after preview',ownerId:user.id,phone:'+492221234567'}});ids.push(conflicting.id);
  await assert.rejects(commit(stale),/已变化/);assert.equal(await db.leadSubmission.count({where:{eventKey:`meta:${prefix}-stale`}}),0);
  const within=make(prefix+'-batch1','Batch','+441112223334')+'\n'+make(prefix+'-batch2','Batch','+441112223334').split('\n')[1]+'\n'+make(prefix+'-batch2','Batch','+441112223334').split('\n')[1];
  const sameFile=await preview(within);assert.deepEqual(sameFile.rows.map(r=>r.status),['NEW','REPEAT','IMPORTED']);
  await assert.rejects(commit(sameFile,[3]),/首次留资未选中/);const withinResult=await commit(sameFile,[2,3]);assert.equal(withinResult.created,1);assert.equal(withinResult.repeated,1);
  const duplicateColumns=await preview('id,full_name,name,created_time\nx,Jean,John,2024-01-01');assert.equal(duplicateColumns.mapping.name,'ignore');assert.equal(duplicateColumns.rows[0].status,'INVALID');
  const simultaneous=await preview(make(prefix+'-concurrent','Concurrent','+441119991111'));
  const parallel=await Promise.all([commit(simultaneous),commit(simultaneous)]);assert.deepEqual(parallel[0],parallel[1]);
  assert.equal(await db.leadSubmission.count({where:{eventKey:`meta:${prefix}-concurrent`}}),1);
  const retired=await db.customer.create({data:{name:'Deleted customer',phone:'+441111009999',ownerId:user.id,deletedAt:new Date()}});ids.push(retired.id);
  const deleted=await preview(make(prefix+'-deleted','Deleted','+441111009999'));assert.equal(deleted.rows[0].status,'SUSPECT');assert.ok(deleted.rows[0].candidates[0].deleted);
  assert.deepEqual(await db.$queryRawUnsafe('PRAGMA foreign_key_check'),[]);
 }finally{
  await db.leadSubmission.deleteMany({where:{customerId:{in:ids}}});await db.stageHistory.deleteMany({where:{customerId:{in:ids}}});await db.customer.deleteMany({where:{id:{in:ids}}});await db.metaImportRun.deleteMany({where:{id:{in:runIds}}});await db.$disconnect();
 }
});

test('翻译设置加密、专有信息保护与服务失败保留原文',async()=>{
 const old=await db.translationSetting.findUnique({where:{id:'meta'}}),originalFetch=globalThis.fetch;
 try{
  await saveTranslationSettings({endpoint:'https://translator.example.test/translate',apiKey:'test-only-secret'});
  assert.equal((await translationSettings()).keyConfigured,true);assert.ok(!(await db.translationSetting.findUniqueOrThrow({where:{id:'meta'}})).encryptedKey.includes('test-only-secret'));
  globalThis.fetch=async(_url,options)=>{const body=options!.body as URLSearchParams;assert.ok(!body.get('q')!.includes('X-100'));assert.equal(body.get('api_key'),'test-only-secret');return new Response(JSON.stringify({translatedText:'需要型号 '+body.get('q')!.match(/ZXQKEEP\d+QXZ/)![0]}),{status:200});};
  const t=await translator();assert.deepEqual(await t.translate('Need model X-100',['X-100']),{text:'需要型号 X-100',pending:false});
  globalThis.fetch=async()=>new Response('failed',{status:500});const failed=await translator();assert.deepEqual(await failed.translate('untranslated answer'),{text:'untranslated answer',pending:true});
  await saveTranslationSettings({endpoint:'https://other.example.test/translate'});assert.equal((await translationSettings()).keyConfigured,false);
 }finally{globalThis.fetch=originalFetch;if(old)await db.translationSetting.upsert({where:{id:'meta'},create:old,update:old});else await db.translationSetting.deleteMany({where:{id:'meta'}});await db.$disconnect();}
});
