import { deleteTestCustomers, deleteTestOrders } from './identity-test-cleanup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { inquiryDate, isBusinessDate, parseInquiryDate } from '../lib/customer-date';
import { dayKey, periodRange } from '../lib/time';
import { saveCustomer, addDeal, addFollowUp } from '../services/customer-service';
import { dashboard } from '../services/dashboard-service';
import { batchCustomers } from '../services/customer-batch-service';

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
  const decBefore=await dashboard(user,'MONTH','2024-12-01','CNY');
  const janBefore=await dashboard(user,'MONTH','2025-01-01','CNY');
  const nowKey=dayKey(new Date(),settings.timezone);
  const nowBefore=await dashboard(user,'MONTH',nowKey,'CNY');
  const input={name:'日期回归专用客户',ownerId:user.id,source:'FACEBOOK',country:'日期测试国家',isQualified:true,inquiryAt:'2024-12-31'};
  try{
    const c=await saveCustomer(input,user);ids.push(c.id);
    assert.equal(dayKey(c.inquiryAt!,settings.timezone),'2024-12-31');
    assert.equal(dayKey(c.createdAt,settings.timezone),nowKey);
    const dec=await dashboard(user,'MONTH','2024-12-01','CNY');
    assert.equal(dec.current.inquiries,decBefore.current.inquiries+1);
    assert.equal(dec.current.qualified,decBefore.current.qualified+1);
    assert.equal(dec.sources.find(s=>s.name==='FACEBOOK')!.inquiries,(decBefore.sources.find(s=>s.name==='FACEBOOK')?.inquiries??0)+1);
    assert.equal(dec.countries.find(s=>s.name===input.country)!.inquiries,1);
    assert.equal(dec.trend.reduce((n,b)=>n+b.询盘,0),dec.current.inquiries);
    assert.equal(dec.funnel[0].count,decBefore.funnel[0].count+1);
    assert.equal((await dashboard(user,'MONTH',nowKey,'CNY')).current.inquiries,nowBefore.current.inquiries);
    const moved=await saveCustomer({...input,inquiryAt:'2025-01-01'},user,c.id);
    assert.equal(moved.createdAt.getTime(),c.createdAt.getTime());
    assert.equal((await dashboard(user,'MONTH','2024-12-01','CNY')).current.inquiries,decBefore.current.inquiries);
    assert.equal((await dashboard(user,'MONTH','2025-01-01','CNY')).current.inquiries,janBefore.current.inquiries+1);
    const unchanged=await saveCustomer({...input,inquiryAt:undefined,name:'日期回归改名'},user,c.id);
    assert.equal(unchanged.inquiryAt?.getTime(),moved.inquiryAt?.getTime());
    for(const inquiryAt of ['2099-01-01','2025-02-30',''])await assert.rejects(saveCustomer({...input,inquiryAt},user,c.id));
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:c.id}})).inquiryAt?.getTime(),moved.inquiryAt?.getTime());
    await batchCustomers({ids:[c.id]},user);
    assert.equal((await dashboard(user,'MONTH','2025-01-01','CNY')).current.inquiries,janBefore.current.inquiries);
    await batchCustomers({ids:[c.id]},user,true);
    assert.equal((await dashboard(user,'MONTH','2025-01-01','CNY')).current.inquiries,janBefore.current.inquiries+1);
    await assert.rejects(addDeal(c.id,{dealDate:'2024-12-31',dealAmount:1000,productCost:600,currency:'CNY'},user),/不能早于询盘/);
    await assert.rejects(addFollowUp(c.id,{followUpAt:'2024-12-31',type:'PHONE',content:'错误日期'},user),/不能早于询盘/);
    await addDeal(c.id,{dealDate:'2025-02-03',dealAmount:1000,productCost:600,currency:'CNY'},user);
    const afterDeal=await db.customer.findUniqueOrThrow({where:{id:c.id}});
    await assert.rejects(saveCustomer({...input,stage:'WON',inquiryAt:'2025-02-04'},user,c.id),/询盘日期不能晚于/);
    assert.equal((await db.customer.findUniqueOrThrow({where:{id:c.id}})).inquiryAt?.getTime(),afterDeal.inquiryAt?.getTime());
    const jan=await dashboard(user,'MONTH','2025-01-01','CNY');
    assert.equal(jan.current.revenue,janBefore.current.revenue);
    assert.equal(jan.current.won,janBefore.current.won+1);
    assert.equal((await dashboard(user,'MONTH',nowKey,'CNY')).current.revenue,nowBefore.current.revenue);
    const normal=await saveCustomer({name:'默认日期验证',ownerId:user.id},user);ids.push(normal.id);
    assert.equal(dayKey(normal.inquiryAt!,settings.timezone),nowKey);
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
