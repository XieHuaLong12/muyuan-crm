import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextConfig from '../next.config';
import { workspaceHome,workspaceNavigation,activeWorkspace,activeWorkspaceLink,phoneNavigation } from '../lib/role-workspace';
import { createSession,parseSession } from '../lib/session';

/** Every page route under app/, as a matcher (route groups removed, dynamic segments as wildcards). */
function pageRoutes(dir=fileURLToPath(new URL('../app', import.meta.url)),prefix=''):RegExp[]{
  const routes:RegExp[]=[];
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    if(entry.isFile()&&entry.name==='page.tsx'){
      const pattern=(prefix||'/').replace(/\/\[\[\.\.\.[^\]]+\]\]/g,'(?:/.*)?').replace(/\[\.\.\.[^\]]+\]/g,'.+').replace(/\[[^\]]+\]/g,'[^/]+');
      routes.push(new RegExp(`^${pattern}$`));
    }
    if(entry.isDirectory()&&entry.name!=='api')routes.push(...pageRoutes(join(dir,entry.name),/^\(.+\)$/.test(entry.name)?prefix:`${prefix}/${entry.name}`));
  }
  return routes;
}
const isPage=(path:string)=>pageRoutes().some(route=>route.test(path));

test('the sidebar is short: related pages are tabs of one section',()=>{
  assert.equal(workspaceHome('SALES'),'/sales');assert.equal(workspaceHome('ADMIN'),'/workbench');
  assert.deepEqual(workspaceNavigation('SALES').map(item=>item.label),['今日工作','消息','话术','我的客户','产品与报价','我的订单','我的业绩']);
  assert.deepEqual(workspaceNavigation('ADMIN').map(item=>item.label),['工作台','经营总览','客户','消息','任务','订单','广告与线索','团队','设置']);
  const salesPaths=workspaceNavigation('SALES').flatMap(item=>[item.href,...(item.tabs??[]).map(tab=>tab.href)]);
  for(const path of ['/command-center','/command-center/customers','/command-center/messages','/growth','/analytics/ads','/finance','/settings','/team','/communication','/targets'])assert.equal(salesPaths.includes(path),false,path);
  for(const role of ['SALES','ADMIN']){
    const sections=workspaceNavigation(role);
    assert.equal(new Set(sections.map(item=>item.icon)).size,sections.length,`${role} icons are distinct`);
    for(const section of sections){
      assert.ok(isPage(section.href),`${section.href} is a page`);
      for(const tab of section.tabs??[]){
        assert.ok(isPage(tab.href),`${tab.href} is a page`);
        // Opening a tab highlights that tab and its section.
        const active=activeWorkspace(tab.href,role);
        assert.equal(active?.section.href,section.href,tab.href);assert.equal(active?.tab?.href,tab.href,tab.href);
      }
    }
  }
});

test('the phone bar shows four sections and keeps every other one behind 更多',()=>{
  assert.deepEqual(phoneNavigation('ADMIN').bar.map(item=>[item.label,item.section.href]),[['今日','/workbench'],['消息','/messages'],['客户','/customers'],['数据','/command-center']]);
  assert.deepEqual(phoneNavigation('SALES').bar.map(item=>[item.label,item.section.href]),[['今日','/sales'],['消息','/messages'],['客户','/customers'],['报价','/products']]);
  assert.deepEqual(phoneNavigation('ADMIN').more.map(section=>section.label),['任务','订单','广告与线索','团队','设置']);
  assert.deepEqual(phoneNavigation('SALES').more.map(section=>section.label),['话术','我的订单','我的业绩']);
  for(const role of ['SALES','ADMIN']){
    const {bar,more}=phoneNavigation(role);
    // Nothing is lost or shown twice: bar and 更多 together are exactly the sidebar.
    assert.deepEqual([...bar.map(item=>item.section.href),...more.map(section=>section.href)].sort(),workspaceNavigation(role).map(section=>section.href).sort());
    assert.equal(bar[0].section.href,workspaceHome(role));
    // The live counts (today's work, the assignment pool, unread messages) stay one tap away.
    for(const section of more)assert.equal(section.badge,undefined,section.label);
  }
});

test('analysis sections keep the shared period when switching tabs',()=>{
  const keep=workspaceNavigation('ADMIN').filter(section=>section.keepPeriod).map(section=>section.label);
  assert.deepEqual(keep,['经营总览','广告与线索']);
});

test('detail pages and tools highlight the section they belong to',()=>{
  const at=(path:string,role:string)=>{const active=activeWorkspace(path,role);return [active?.section.label,active?.tab?.label];};
  assert.deepEqual(at('/tasks','SALES'),['今日工作','全部待办']);
  assert.deepEqual(at('/customers/customer-id','SALES'),['我的客户','新客户']);
  assert.deepEqual(at('/customers/legacy','SALES'),['我的客户','旧客户']);
  assert.deepEqual(at('/customers/legacy','ADMIN'),['客户','旧客户']);
  assert.deepEqual(at('/crm','SALES'),['我的客户','销售看板']);
  assert.deepEqual(at('/sales/performance','SALES'),['我的业绩',undefined]);
  assert.deepEqual(at('/products/product-id','SALES'),['产品与报价','产品库']);
  assert.deepEqual(at('/products/quotes/quote-id','SALES'),['产品与报价','报价单']);
  assert.deepEqual(at('/products/quotes/new','ADMIN'),['订单','报价单']);
  assert.deepEqual(at('/products/quotes/settings','ADMIN'),['订单','报价单']);
  assert.deepEqual(at('/products/freight','SALES'),['产品与报价','运费库']);
  assert.deepEqual(at('/orders/detail/order-id','ADMIN'),['订单','订单']);
  assert.deepEqual(at('/products/margin','ADMIN'),['订单','利润']);
  assert.deepEqual(at('/products/product-id','ADMIN'),['订单','产品库']);
  assert.deepEqual(at('/analytics/loss-reasons','ADMIN'),['广告与线索','丢单原因']);
  assert.deepEqual(at('/analytics/ads/ad-id','ADMIN'),['广告与线索','广告效果']);
  assert.deepEqual(at('/growth/intake','ADMIN'),['广告与线索','线索接入']);
  assert.deepEqual(at('/communication/whatsapp-sync','ADMIN'),['团队','沟通监督']);
  assert.deepEqual(at('/settings/integrations/whatsapp','ADMIN'),['设置','集成与接入']);
  assert.deepEqual(at('/admin/integration-debug','ADMIN'),['设置','集成与接入']);
  assert.deepEqual(at('/command-center/analysis','ADMIN'),['经营总览','来源与国家']);
  assert.deepEqual(at('/command-center/customers','ADMIN'),['经营总览','客户分析']);
  assert.deepEqual(at('/command-center/messages','ADMIN'),['经营总览','消息分析']);
  assert.equal(activeWorkspaceLink('/growth/intake','ADMIN'),'/analytics/ads');
  assert.equal(activeWorkspace('/login','ADMIN'),null);
});

test('old addresses redirect to the merged pages instead of 404',async()=>{
  const rules=await nextConfig('phase-production-build').redirects!();
  const sources=rules.map(rule=>rule.source);
  for(const old of ['/command-center/legacy','/analytics','/funnel','/orders/list','/customer-directory','/whatsapp','/whatsapp/inbox','/today','/growth'])assert.ok(sources.includes(old),old);
  for(const rule of rules){
    assert.equal(isPage(rule.source),false,`${rule.source} no longer has its own page`);
    assert.ok(isPage(rule.destination),`${rule.destination} exists`);
    assert.equal(rule.permanent,false);
  }
});

test('versioned sessions reject tampering and invalid expiry; legacy version zero remains compatible',()=>{
  const secret='test-secret',now=Date.now(),raw=createSession('sales-user',3,secret,now);
  assert.deepEqual(parseSession(raw,secret,now),{id:'sales-user',version:3});
  assert.equal(parseSession(raw.replace('.3.','.4.'),secret,now),null);
  assert.equal(parseSession(raw,secret,now+8*86400000),null);
  for(const expiry of ['NaN','Infinity','bad']){
    const value=`sales-user.${expiry}.0`,signature=createHmac('sha256',secret).update(value).digest('hex');
    assert.equal(parseSession(`${value}.${signature}`,secret,now),null);
  }
  const value=`sales-user.${now+10000}`;
  assert.deepEqual(parseSession(`${value}.${createHmac('sha256',secret).update(value).digest('hex')}`,secret,now),{id:'sales-user',version:0});
});
