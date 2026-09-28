import test from 'node:test';
import assert from 'node:assert/strict';
import {e164,matchPhone,sourceKey,webBatch} from '../lib/whatsapp-web-sync';
const customer=(id:string,phone:string,name='Same')=>({id,name,phone,whatsapp:'',whatsappNormalized:'',waId:null});
const message={sourceMessageId:'false_8613812345678@c.us_ABCD',conversationId:'8613812345678@c.us',peerPhone:'+8613812345678',peerName:'Alias',direction:'inbound',sentAt:'2026-09-27T09:30:00.000Z',text:'hello',attachments:[]};
test('E.164 requires explicit international prefix and rejects ambiguous local numbers',()=>{
 assert.equal(e164('+86 138 1234 5678'),'+8613812345678');
 assert.equal(e164('008613812345678'),'+8613812345678');
 assert.equal(e164('13812345678'),null);
 assert.equal(e164('+01234'),null);
});
test('exact phone only; duplicate numbers remain ambiguous regardless of names',()=>{
 assert.equal(matchPhone('+8613812345678',[customer('a','+8613812345678')]).status,'matched');
 assert.equal(matchPhone('+8613812345678',[customer('a','+8613812345678'),customer('b','008613812345678')]).status,'ambiguous');
 assert.equal(matchPhone('+8613812345678',[{...customer('a',''),whatsappNormalized:'8613812345678'}]).status,'matched');
 assert.equal(matchPhone(null,[customer('a','+8613812345678','Alias')]).status,'unmatched');
 assert.equal(matchPhone('+8613812345678',[customer('a','8613812345678','Alias')]).status,'unmatched');
});
test('web identity is stable and account-scoped',()=>{
 const a=sourceKey('+8613812345678',message),b=sourceKey('+8613812345678',message);
 assert.equal(a,b);assert.notEqual(a,sourceKey('+8613812345679',message));
});
test('payload accepts attachment metadata and rejects URLs, cookies or extra fields',()=>{
 assert.equal(webBatch.safeParse({accountPhone:'+8613812345678',messages:[message]}).success,true);
 assert.equal(webBatch.safeParse({accountPhone:'+8613812345678',messages:[{...message,attachments:[{kind:'image',url:'blob:secret'}]}]}).success,false);
 assert.equal(webBatch.safeParse({accountPhone:'+8613812345678',messages:[{...message,attachments:[{kind:'image',fileName:'blob:secret'}]}]}).success,false);
 assert.equal(webBatch.safeParse({accountPhone:'+8613812345678',messages:[{...message,cookie:'secret'}]}).success,false);
});
