import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { sourceKey } from '../lib/whatsapp-web-sync';
import { reconcilePendingWebSync, searchSyncCustomers } from '../services/whatsapp-web-sync-service';

test('legacy WhatsApp digits match +E.164 search and reconcile pending messages exactly once', async () => {
  const suffix=randomUUID(),accountPhone='+8613812345678',conversationId=`test-${suffix}`;
  const user=await db.user.create({data:{name:'Sync match test',email:`sync-${suffix}@example.invalid`,passwordHash:'test',role:'SALES'}});
  const actor={id:user.id,name:user.name,email:user.email,role:user.role};
  const customerIds:string[]=[];
  try{
    const target=await db.customer.create({data:{name:'Mr. Lovett',ownerId:user.id,whatsapp:'971585891501',whatsappNormalized:''}});
    customerIds.push(target.id);
    for(let i=0;i<2;i++){
      const other=await db.customer.create({data:{name:`Ambiguous ${i}`,ownerId:user.id,whatsapp:'971585891502',whatsappNormalized:''}});
      customerIds.push(other.id);
    }
    const found=await searchSyncCustomers('+971585891501',actor);
    assert.deepEqual(found.map(c=>c.id),[target.id]);
    assert.deepEqual((await searchSyncCustomers('971585891501',actor)).map(c=>c.id),[target.id]);
    for(const [index,peerPhone] of ['+971585891501','+971585891501','+971585891502'].entries()){
      const sourceMessageId=`sync-${suffix}-${index}`;
      await db.whatsAppUnmatchedMessage.create({data:{sourceKey:sourceKey(accountPhone,{conversationId,sourceMessageId}),userId:user.id,accountPhone,
        conversationId,sourceMessageId,peerPhone,peerName:'Mr. Lovett',direction:'inbound',sentAt:new Date('2026-09-25T12:00:00Z'),
        content:`test message ${index}`,attachments:'[]',reason:'NO_MATCH'}});
    }
    const first=await reconcilePendingWebSync(actor);
    assert.equal(first.imported,2);
    assert.equal(first.skipped,1);
    assert.equal(await db.whatsAppMessage.count({where:{customerId:target.id,source:'whatsapp_web'}}),2);
    assert.equal(await db.whatsAppUnmatchedMessage.count({where:{userId:user.id,status:'PENDING'}}),1);
    const second=await reconcilePendingWebSync(actor);
    assert.equal(second.imported,0);
    assert.equal(await db.whatsAppMessage.count({where:{customerId:target.id,source:'whatsapp_web'}}),2);
  }finally{
    await db.whatsAppMessage.deleteMany({where:{customerId:{in:customerIds}}});
    await db.whatsAppUnmatchedMessage.deleteMany({where:{userId:user.id}});
    await db.customer.deleteMany({where:{id:{in:customerIds}}});
    await db.user.delete({where:{id:user.id}});
    await db.$disconnect();
  }
});
