import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { workspaceHome,workspaceNavigation,activeWorkspaceLink } from '../lib/role-workspace';
import { createSession,parseSession } from '../lib/session';

test('sales navigation and deep links consistently stay in the personal workspace',()=>{
  assert.equal(workspaceHome('SALES'),'/sales');assert.equal(workspaceHome('ADMIN'),'/command-center');
  const sales=workspaceNavigation('SALES').map(item=>item.href);
  for(const path of ['/command-center','/growth','/analytics/ads','/finance','/settings','/team','/communication','/whatsapp','/today'])assert.equal(sales.includes(path as typeof sales[number]),false);
  assert.ok(sales.includes('/sales/performance'));assert.ok(workspaceNavigation('ADMIN').some(item=>item.href==='/team'));
  assert.equal(activeWorkspaceLink('/sales/performance','SALES'),'/sales/performance');
  assert.equal(activeWorkspaceLink('/customers/customer-id','SALES'),'/customers');
  assert.equal(activeWorkspaceLink('/whatsapp/inbox','SALES'),undefined);assert.equal(activeWorkspaceLink('/whatsapp/inbox','ADMIN'),'/communication');
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
