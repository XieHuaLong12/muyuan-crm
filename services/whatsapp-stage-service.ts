import { db } from '@/lib/db';
import type { ConversationAnalysis } from './whatsapp-ai-service';
import { analyzeIncrementalCustomer } from './customer-intelligence-service';

// Compatibility export: all AI stage output is now advisory, never a CRM fact.
export function shouldApplyStage(current: string, analysis: ConversationAnalysis, latestInbound: string) {
  void current; void analysis; void latestInbound;
  return false;
}
export async function updateWhatsAppStage(customerId: string) {
  if (!process.env.DEEPSEEK_API_KEY) return;
  const c = await db.customer.findFirst({where:{id:customerId,deletedAt:null},include:{owner:{select:{id:true,name:true,email:true,role:true}}}});
  if(c)await analyzeIncrementalCustomer(customerId,c.owner);
}
