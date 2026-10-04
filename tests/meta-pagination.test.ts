import test from 'node:test';
import assert from 'node:assert/strict';
import { pagedGraphGet } from '../lib/meta-graph';
test('Graph pagination retains cursor/query, uses one version and never sends credentials to another host',async()=>{
  const original=globalThis.fetch;const calls:URL[]=[];
  try{
    globalThis.fetch=async(input,init)=>{const url=new URL(String(input));calls.push(url);assert.equal(url.searchParams.has('access_token'),false);assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer test-token');
      if(calls.length===1)return Response.json({data:[{id:'one'}],paging:{next:'https://graph.facebook.com/v26.0/act_1/insights?after=cursor-two&limit=500&fields=ad_id&access_token=never-use-this'}});
      assert.equal(url.pathname,'/v26.0/act_1/insights');assert.equal(url.searchParams.get('after'),'cursor-two');assert.equal(url.searchParams.get('fields'),'ad_id');return Response.json({data:[{id:'two'}]});};
    assert.deepEqual((await pagedGraphGet('act_1/insights','test-token',{limit:'500'})).rows,[{id:'one'},{id:'two'}]);
    globalThis.fetch=async()=>Response.json({data:[],paging:{next:'https://example.test/steal?access_token=x'}});
    assert.equal((await pagedGraphGet('act_1/insights','test-token',{})).error,'GRAPH_UNTRUSTED_PAGING_URL');
    globalThis.fetch=async()=>Response.json({error:{code:190,message:'Expired test-token'}},{status:401});
    const expired=await pagedGraphGet('act_1/insights','test-token',{});assert.match(expired.error!,/TOKEN_EXPIRED/);assert.ok(!expired.error!.includes('test-token'));
  }finally{globalThis.fetch=original;}
});
