import { Prisma } from '@prisma/client';
import { canonicalPhone } from '@/lib/contact-identity';

/** Only a shared native WhatsApp ID and exact account/peer/direction prove cross-source identity.
 * DOM-only IDs and similar text/timestamps are never silently merged. */
export async function exactCrossSourceMessage(tx:Prisma.TransactionClient,input:{nativeId:string;accountPhone:string;peerPhone:string;direction:string;source:string;customerId:string}) {
  if(!input.nativeId.startsWith('wamid.'))return null;
  const account=canonicalPhone(input.accountPhone,undefined,true),peer=canonicalPhone(input.peerPhone,undefined,true);
  if(!account||!peer)return null;
  return tx.whatsAppMessage.findFirst({where:{customerId:input.customerId,providerAccountId:account,waId:peer.slice(1),
    direction:input.direction.toUpperCase(),source:{in:['gupshup','whatsapp_web'],not:input.source},
    OR:[{waMessageId:input.nativeId},{sourceMessageId:input.nativeId}]},select:{id:true,conversationId:true,source:true}});
}
