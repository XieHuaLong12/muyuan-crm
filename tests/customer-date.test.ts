import { deleteTestCustomers, deleteTestOrders } from './identity-test-cleanup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { inquiryDate, isBusinessDate, parseInquiryDate } from '../lib/customer-date';
import { dayKey, periodRange } from '../lib/time';
import { saveCustomer, addDeal, addFollowUp } from '../services/customer-service';
import { sourcesAndCountries } from '../services/source-analysis-service';
import { businessCockpit } from '../services/business-cockpit-service';
import { batchCustomers } from '../services/customer-batch-service';

type Admin={id:string;name:string;email:string;role:string};
/** One calendar month of the cockpit and source analysis (same metric rules), or the current month so far. */
async function month(user:Admin,key:string,timezone:string){
  const today=dayKey(new Date(),timezone);
  const last=new Date(Date.UTC(+key.slice(0,4),+key.slice(5,7),0)).toISOString().slice(0,10);
  const query=key.slice(0,7)===today.slice(0,7)?{range:'month'}:{range:'custom',startDate:`${key.slice(0,7)}-01`,endDate:last};
  const [s,c]=await Promise.all([sourcesAndCountries(user,query),businessCockpit(user,query)]);
  return {inquiries:s.totals.inquiries,qualified:s.totals.qualified,revenue:Number(s.totals.revenue.find(r=>r.currency==='CNY')?.amount??0),won:c.funnel[4].count,sources:s.sources,countries:s.countries};
}

test('询盘日期校验、闰日、时区及周/月/年边界',()=>{
  const tz='Asia/Shanghai',now=new Date('2026-09-12T12:00:00Z');
  for(const value of ['', '2025-02-29','2024-02-30','2024-13-01','2024-01-00','2024-01-01T24:00','bad'])assert.equal(isBusinessDate(value),false,value);
  assert.equal(dayKey(parseInquiryDate('2024-02-29',tz,now),tz),'2024-02-29');
  assert.equal(parseInquiryDate('2025-01-01',tz,now).toISOString(),'2024-12-31T16:00:00.000Z');
  assert.throws(()=>parseInquiryDate('2099-01-01',tz,now),/不能晚于/);
  assert.throws(()=>parseInquiryDate('2024-03-10T02:30','America/New_York',now),/不存在/);
  for(const [period,date] of [['WEEK','2025-01-06'],['MONTH','2025-01-01'],['YEAR','2025-01-01']] as const){
    const range=periodRange(period,date,tz),d=parseInquiryDate(date,tz,now);
    assert.equal(d.getTime(),range.start.getTime());
    assert.ok(new Date(d.getTime()-1)<range.start);
  }
  const legacy={createdAt:new Date('2024-12-31T23:59:59.123Z'),inquiryAt:null};
  assert.equal(inquiryDate(legacy),legacy.createdAt);
});

test('历史询盘归因、日期修改、默认值、删除恢复及订单统计相互独立',async()=>{
  const user=await db.user.findUniqueOrThrow({where:{email:'admin@example.com'}});
  const settings=await db.setting.findUniqueOrThrow({where:{id:'system'}});
  const ids:string[]=[];
  const tz=settings.timezone,at=(key:string)=>month(user,key,tz);
  const decBefore=await at('2024-12-01');
  const janBefore=await at('2025-01-01');
  const nowKey=dayKey(new Date(),tz);
  const nowBefore=await at(nowKey);
  const input={name:'日期回归专用客户',ownerId:user.id,source:'FACEBOOK',country:'日期测试国家',isQualified:true,inquiryAt:'2024-12-31'};
  try{
    const c=await saveCustomer(input,user);ids.push(c.id);
    assert.equal(dayKey(c.inquiryAt!,settings.timezone),'2024-12-31');
    assert.equal(dayKey(c.createdAt,settings.timezone),nowKey);
    const dec=await at('2024-12-01');
    assert.equal(dec.inquiries,decBefore.inquiries+1);
    assert.equal(dec.qualified,decBefore.qualified+1);
    assert.equal(dec.sources.find(s=>s.key==='FACEBOOK')!.inquiries,(decBefore.sources.find(s=>s.key==='FACEBOOK')?.inquiries??0)+1);
    assert.equal(dec.countries.find(s=>s.key===input.country)!.inquiries,1);
    assert.equal((await at(nowKey)).inquiries,nowBefore.inquiries);
    const moved=await saveCustomer({...input,inquiryAt:'2025-01-01'},user,c.id);
    assert.equal(moved.createdAt.getTime(),c.createdAt.getTime());
    assert.equal((await at('2024-12-01')).inquiries,decBefore.inquiries);
    assert.equal((await at('2025-01-01')).inquiries,janBefore.inquiries+1);
    const unchanged=await saveCustomer({...input,inquiryAt:undefined,name:'日期回归改名'},user,c.id);
    assert.equal(unchanged.inquiryAt?.getTime(),moved.inquiryAt?.getTime());
    for(const inquiryAt of ['2099-01-01','2025-02-30',''])await assert.rejects(saveCustomer({...input,inquiryAt},user,c.id));
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:c.id}})).inquiryAt?.getTime(),moved.inquiryAt?.getTime());
    await batchCustomers({ids:[c.id]},user);
    assert.equal((await at('2025-01-01')).inquiries,janBefore.inquiries);
    await batchCustomers({ids:[c.id]},user,true);
    assert.equal((await at('2025-01-01')).inquiries,janBefore.inquiries+1);
    await assert.rejects(addDeal(c.id,{dealDate:'2024-12-31',dealAmount:1000,productCost:600,currency:'CNY'},user),/不能早于询盘/);
    await assert.rejects(addFollowUp(c.id,{followUpAt:'2024-12-31',type:'PHONE',content:'错误日期'},user),/不能早于询盘/);
    await addDeal(c.id,{dealDate:'2025-02-03',dealAmount:1000,productCost:600,currency:'CNY'},user);
    const afterDeal=await db.customer.findUniqueOrThrow({where:{id:c.id}});
    await assert.rejects(saveCustomer({...input,stage:'WON',inquiryAt:'2025-02-04'},user,c.id),/询盘日期不能晚于/);
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:c.id}})).inquiryAt?.getTime(),afterDeal.inquiryAt?.getTime());
    const jan=await at('2025-01-01');
    assert.equal(jan.revenue,janBefore.revenue);
    assert.equal(jan.won,janBefore.won+1);
    assert.equal((await at(nowKey)).revenue,nowBefore.revenue);
    const normal=await saveCustomer({name:'默认日期验证',ownerId:user.id},user);ids.push(normal.id);
    assert.equal(dayKey(normal.inquiryAt!,tz),nowKey);
    // Existing timestamps retain millisecond precision when the displayed date is unchanged.
    const exact=new Date('2025-01-01T04:05:06.789Z');
    await db.customer.update({where:{id:normal.id},data:{inquiryAt:exact}});
    const preserved=await saveCustomer({name:normal.name,ownerId:user.id,inquiryAt:dayKey(exact,settings.timezone)},user,normal.id);
    assert.equal(preserved.inquiryAt?.getTime(),exact.getTime());
  }finally{
    await db.followUp.deleteMany({where:{customerId:{in:ids}}});
    await db.deal.deleteMany({where:{customerId:{in:ids}}});
    // 订单随成交产生，且外键为 RESTRICT，必须先清掉
    await deleteTestOrders({where:{customerId:{in:ids}}});
    await db.stageHistory.deleteMany({where:{customerId:{in:ids}}});
    await deleteTestCustomers({where:{id:{in:ids}}});
    await db.$disconnect();
  }
});
