import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./collector.js',import.meta.url),'utf8');
function row(id,stamp,tail,body='Hello'){
 const textNode={textContent:body,closest:()=>null};
 return {classList:{contains:()=>false},getAttribute:x=>x==='data-id'?id:null,
  querySelector:x=>x==='[data-pre-plain-text]'?{getAttribute:()=>stamp}:x===`[data-testid="${tail}"]`?{}:null,
  querySelectorAll:x=>x==='.selectable-text'?[textNode]:[]};
}
function collect(rows,{title='Anne',phone=null}={}){
 const main={querySelector:x=>x==='header [data-testid="conversation-info-header-chat-title"]'?{textContent:title}:null,querySelectorAll:()=>rows};
 const drawer=phone?{querySelector:x=>x==='[data-testid="contact-info-subtitle selectable-text"]'?{textContent:title}:null,querySelectorAll:()=>[{textContent:phone}]}:null;
 const context={document:{querySelector:x=>x==='#main'?main:drawer},Date,globalThis:{}};
 vm.runInNewContext(source,context);
 return context.globalThis.__lvanjuCollectLoaded({dateOrder:'DMY'});
}
test('reads visible direct chat with legacy JID and numeric date',()=>{
 const r=collect([row('false_8613812345678@c.us_ABC','[12:42, 28/09/2026] Anne: ','tail-in')]);
 assert.equal(r.messages.length,1);assert.equal(r.messages[0].peerPhone,'+8613812345678');
 assert.equal(r.messages[0].sourceMessageId,'false_8613812345678@c.us_ABC');assert.equal(r.messages[0].direction,'inbound');
});
test('reads current opaque IDs, Chinese date and consecutive messages when contact info is open',()=>{
 const rows=[row('3EB0AAA','[17:32, 2026年8月17日] Lvanju Jason: ','tail-out'),
 row('3EB0BBB','[17:33, 2026年8月17日] Lvanju Jason: ','none'),
 row('3EB0CCC','[17:36, 2026年8月17日] Anne: ','tail-in')];
 const r=collect(rows,{phone:'+33 6 58 91 70 57'});
 assert.equal(r.messages.length,3);assert.deepEqual(Array.from(r.messages,m=>m.direction),['outbound','outbound','inbound']);
 assert.ok(r.messages.every(m=>m.peerPhone==='+33658917057'));
 assert.ok(r.messages.every(m=>m.conversationId==='opaque'));
});
test('without visible phone, known direct chat enters unmatched queue',()=>{
 const r=collect([row('3EB0CCC','[17:36, 2026年8月17日] Anne: ','tail-in')]);
 assert.equal(r.messages.length,1);assert.equal(r.messages[0].peerPhone,null);
});
test('skips invalid times and group chat IDs',()=>{
 assert.equal(collect([row('3EB0AAA','bad time','tail-in')]).messages.length,0);
 assert.equal(collect([row('false_123456789@g.us_ABC','[12:42, 28/09/2026] Anne: ','tail-in')]).messages.length,0);
});
