import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./collector.js',import.meta.url),'utf8');
function collect(id='false_8613812345678@c.us_ABC',stamp='[12:42, 28/09/2026] Alice: '){
 const textNode={textContent:'Hello',closest:()=>null};
 const row={classList:{contains:x=>x==='message-in'},getAttribute:x=>x==='data-id'?id:null,
 querySelector:x=>x==='[data-pre-plain-text]'?{getAttribute:()=>stamp}:null,
 querySelectorAll:x=>x==='.selectable-text'?[textNode]:[]};
 const main={querySelector:x=>x==='header [title]'?{getAttribute:()=>'+8613812345678'}:null,
 querySelectorAll:()=>[row]};
 const context={document:{querySelector:()=>main},Date,globalThis:{}};
 vm.runInNewContext(source,context);
 return context.globalThis.__lvanjuCollectLoaded({dateOrder:'DMY'});
}
test('reads one mounted direct chat message with stable ID and local timestamp',()=>{
 const result=collect();assert.equal(result.messages.length,1);assert.equal(result.messages[0].peerPhone,'+8613812345678');
 assert.equal(result.messages[0].sourceMessageId,'false_8613812345678@c.us_ABC');assert.equal(result.messages[0].direction,'inbound');
});
test('skips unsupported timestamp and group chats',()=>{
 assert.equal(collect(undefined,'bad time').messages.length,0);
 assert.equal(collect('false_123456789@g.us_ABC').messages.length,0);
});
