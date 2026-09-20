import { automatedTask } from './workflow-service';
import { db } from '@/lib/db';
import { analyzeConversation, ConversationAnalysis, getConversation } from './whatsapp-ai-service';

export function shouldApplyStage(current: string, analysis: ConversationAnalysis, latestInbound: string) {
  if (['WON', 'INVALID', 'PAUSED', 'ORDER', 'LOST'].includes(current)) return false;
  if (current === analysis.stage || analysis.confidence < 80 || !analysis.evidence || !latestInbound.includes(analysis.evidence)) return false;
  const rank: Record<string, number> = { NEW: 0, CONTACTED: 1, REPLIED: 1, NEEDS_CONFIRMED: 2, QUOTED: 3, FOLLOW_UP: 4, ORDER: 5, LOST: 6 };
  return (rank[analysis.stage] ?? -1) > (rank[current] ?? 0);
}

export async function updateWhatsAppStage(customerId: string) {
  if (!process.env.DEEPSEEK_API_KEY) return;
  const customer = await getConversation(customerId);
  const latest = customer.whatsappMessages.find(m => m.direction === 'INBOUND');
  if (!latest || latest.aiProcessedAt) return;
  const analysis = await analyzeConversation(customer);
  await db.$transaction(async tx => {
    // Optimistic concurrency: do not overwrite manual edits or analysis of newer messages.
    const updated = await tx.customer.updateMany({ where: { id: customerId, deletedAt: null,
      updatedAt: customer.updatedAt, stage: customer.stage }, data: {
      ...(shouldApplyStage(customer.stage, analysis, latest.content) ? {
        stage: analysis.stage,
        ...(analysis.stage === 'CONTACTED' && !customer.contactedAt ? { contactedAt: latest.sentAt } : {}),
        ...(analysis.stage === 'QUOTED' && !customer.quotedAt ? { quotedAt: latest.sentAt } : {}),
        ...(analysis.stage === 'LOST' ? { lostAt: latest.sentAt } : {}),
      } : {}), updatedAt: new Date(),
    } });
    if (!updated.count) return;
    if (shouldApplyStage(customer.stage, analysis, latest.content)) {
      await tx.stageHistory.create({ data: { customerId, fromStage: customer.stage, toStage: analysis.stage,
        changedBy: 'AI:DeepSeek', note: `WhatsApp AI (${analysis.confidence}%): ${analysis.reason}`.slice(0, 190) } });
    }
    if (analysis.nextTask && analysis.confidence >= 80 && analysis.evidence && latest.content.includes(analysis.evidence)) {
      const task=analysis.nextTask;
      const existing=await tx.task.findFirst({where:{customerId,type:task.type,source:'AI',status:{not:'DONE'},deletedAt:null}});
      if(!existing)await automatedTask(tx,{customerId,createdBy:customer.ownerId,title:task.title,type:task.type,source:'AI',
        description:analysis.reason,dueDate:new Date(Date.now()+task.dueInDays*86400000),automationKey:`ai:${latest.id}:${task.type}`});
    }
    await tx.whatsAppMessage.update({ where: { id: latest.id }, data: { aiProcessedAt: new Date() } });
  });
}
