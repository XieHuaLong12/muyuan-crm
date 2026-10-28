import { Prisma } from '@prisma/client';
import { db } from '../lib/db';

function isolated() {
  const url=new URL(process.env.DATABASE_URL||'');
  if(!['127.0.0.1','localhost','mysql'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('身份链测试清理只允许隔离 *_test 数据库');
}
export async function deleteTestOrders(args:{where?:Prisma.OrderWhereInput}) {
  isolated();const orders=await db.order.findMany({where:args.where,select:{id:true}});const ids=orders.map(o=>o.id);
  await db.advertisingFeedback.deleteMany({where:{orderId:{in:ids}}});
  await db.orderAttribution.deleteMany({where:{orderId:{in:ids}}});
  return db.order.deleteMany({where:args.where});
}
export async function deleteTestCustomers(args:{where:Prisma.CustomerWhereInput}) {
  isolated();const customers=await db.customer.findMany({where:args.where,select:{id:true}});const ids=customers.map(c=>c.id);
  await db.advertisingFeedback.deleteMany({where:{customerId:{in:ids}}});
  await deleteTestOrders({where:{customerId:{in:ids}}});
  await db.customerLeadAttribution.deleteMany({where:{customerId:{in:ids}}});
  await db.contactIdentity.deleteMany({where:{customerId:{in:ids}}});
  await db.whatsAppMessage.deleteMany({where:{customerId:{in:ids}}});
  const contacts=await db.whatsAppContact.findMany({where:{customerId:{in:ids}},select:{id:true}});
  const contactIds=contacts.map(c=>c.id);
  await db.whatsAppUnmatchedMessage.deleteMany({where:{OR:[{customerId:{in:ids}},{canonicalConversation:{contactId:{in:contactIds}}}]}});
  await db.whatsAppConversation.deleteMany({where:{contactId:{in:contactIds}}});
  await db.whatsAppContact.deleteMany({where:{id:{in:contactIds}}});
  await db.customerIntelligence.deleteMany({where:{customerId:{in:ids}}});
  await db.leadSubmission.deleteMany({where:{customerId:{in:ids}}});
  await db.stageHistory.deleteMany({where:{customerId:{in:ids}}});
  await db.followUp.deleteMany({where:{customerId:{in:ids}}});
  await db.deal.deleteMany({where:{customerId:{in:ids}}});
  // Radar prospects keep their own history; they only lose the link to a deleted test customer.
  await db.radarProspect.updateMany({where:{customerId:{in:ids}},data:{customerId:null}});
  return db.customer.deleteMany({where:{id:{in:ids}}});
}
