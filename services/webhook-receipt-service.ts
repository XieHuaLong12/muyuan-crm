import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { gupshupSource } from '@/lib/gupshup';
import { validateWhatsAppWebhook, ingestWhatsAppWebhook } from './whatsapp-webhook-service';
import { syncCustomerWorkflow } from './workflow-service';
import { updateWhatsAppStage } from './whatsapp-stage-service';

type ReceiptKind = 'WHATSAPP' | 'META_LEADS';
const kindSchema = z.enum(['WHATSAPP', 'META_LEADS']);

// Persist authenticated evidence before 2xx. Only the payload is stored, never headers/secrets.
export async function acceptWebhookReceipt(input: unknown, kind: ReceiptKind) {
  kindSchema.parse(kind);
  const payload = kind === 'WHATSAPP' ? validateWhatsAppWebhook(input) : z.record(z.unknown()).parse(input);
  const provider = kind === 'META_LEADS' ? 'META' : payload.object !== 'whatsapp_business_account' || typeof payload.gs_app_id === 'string' ? 'GUPSHUP' : 'WHATSAPP';
  const receipt = await db.$transaction(tx => tx.syncJob.create({ data: {
    provider, jobType: 'WEBHOOK_INBOX', status: 'PENDING',
    detail: { kind, providerAccountId: provider === 'GUPSHUP' ? gupshupSource() : null, payload: payload as Prisma.InputJsonObject },
  } }));
  return receipt.id;
}

export async function processWebhookReceipt(id: string) {
  z.string().min(1).max(191).parse(id);
  const receipt = await db.syncJob.findFirstOrThrow({ where: { id, jobType: 'WEBHOOK_INBOX' } });
  if (receipt.status === 'OK') return;
  const detail = z.object({ kind: kindSchema, payload: z.record(z.unknown()) }).parse(receipt.detail);
  await db.syncJob.update({ where: { id }, data: { status: 'RUNNING', error: null } });
  try {
    if (detail.kind === 'META_LEADS') {
      const { handleWebhookPayload } = await import('./meta-lead-service');
      const result = await handleWebhookPayload(detail.payload);
      if (result.error) throw new Error('META_LEAD_PROCESSING_FAILED');
      await db.syncJob.update({ where: { id }, data: { status: 'OK', completedAt: new Date(), processed: result.accepted, succeeded: result.accepted } });
      return;
    }
    const result = await ingestWhatsAppWebhook(detail.payload);
    await db.syncJob.update({ where: { id }, data: { status: 'OK', completedAt: new Date(), processed: result.received + result.outboundEchoes, succeeded: result.matchedCustomers } });
    for (const customerId of new Set(result.customerIds)) {
      try { await syncCustomerWorkflow(customerId); }
      catch { console.error('[WhatsApp Workflow] RETRY_PENDING'); }
      if (process.env.DEEPSEEK_API_KEY) {
        try { await updateWhatsAppStage(customerId); }
        catch { console.error('[WhatsApp Analysis] RETRY_PENDING'); }
      }
    }
  } catch {
    // Acknowledged evidence remains available if background ingestion fails or the process stops.
    await db.syncJob.update({ where: { id }, data: { status: 'FAILED', completedAt: new Date(), failed: 1, error: 'WEBHOOK_PROCESSING_FAILED' } });
    console.error('[Webhook Background] WEBHOOK_PROCESSING_FAILED');
  }
}
