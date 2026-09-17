-- AI + WhatsApp foundation.
-- Additive migration only: no existing customer, follow-up, submission or deal data is removed.

ALTER TABLE "Customer" ADD COLUMN "whatsappNormalized" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "waId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "aiScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN "aiPriority" TEXT NOT NULL DEFAULT 'UNRANKED';
ALTER TABLE "Customer" ADD COLUMN "aiIntent" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Customer" ADD COLUMN "aiSummary" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "aiNextAction" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "aiReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "aiRisk" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "aiLastAnalyzedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "lastWhatsAppAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "lastInboundAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "lastOutboundAt" DATETIME;

-- Backfill a stable matching key from existing WhatsApp values.
UPDATE "Customer"
SET "whatsappNormalized" =
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE("whatsapp", '+', ''),
            ' ', ''),
          '-', ''),
        '(', ''),
      ')', ''),
    '.', ''),
  '/', '');

UPDATE "Customer"
SET "whatsappNormalized" = SUBSTR("whatsappNormalized", 3)
WHERE SUBSTR("whatsappNormalized", 1, 2) = '00';

CREATE INDEX "Customer_whatsappNormalized_idx" ON "Customer"("whatsappNormalized");
CREATE INDEX "Customer_waId_idx" ON "Customer"("waId");
CREATE INDEX "Customer_aiScore_idx" ON "Customer"("aiScore");
CREATE INDEX "Customer_aiPriority_idx" ON "Customer"("aiPriority");
CREATE INDEX "Customer_lastWhatsAppAt_idx" ON "Customer"("lastWhatsAppAt");

CREATE TABLE "WhatsAppMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "waMessageId" TEXT NOT NULL,
  "waId" TEXT NOT NULL DEFAULT '',
  "direction" TEXT NOT NULL,
  "messageType" TEXT NOT NULL DEFAULT 'TEXT',
  "text" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "sentAt" DATETIME NOT NULL,
  "raw" TEXT NOT NULL DEFAULT '',
  "aiProcessedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppMessage_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WhatsAppMessage_waMessageId_key" ON "WhatsAppMessage"("waMessageId");
CREATE INDEX "WhatsAppMessage_customerId_sentAt_idx" ON "WhatsAppMessage"("customerId", "sentAt");
CREATE INDEX "WhatsAppMessage_waId_idx" ON "WhatsAppMessage"("waId");

CREATE TABLE "CustomerIntelligence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "priority" TEXT NOT NULL DEFAULT 'UNRANKED',
  "intent" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "customerType" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "productsJson" TEXT NOT NULL DEFAULT '[]',
  "quantity" INTEGER,
  "currentNeed" TEXT NOT NULL DEFAULT '',
  "mainObjection" TEXT NOT NULL DEFAULT '',
  "suggestedStage" TEXT NOT NULL DEFAULT '',
  "nextAction" TEXT NOT NULL DEFAULT '',
  "reason" TEXT NOT NULL DEFAULT '',
  "risk" TEXT NOT NULL DEFAULT '',
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "lastMessageAt" DATETIME,
  "analyzedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CustomerIntelligence_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomerIntelligence_customerId_key" ON "CustomerIntelligence"("customerId");
CREATE INDEX "CustomerIntelligence_priority_idx" ON "CustomerIntelligence"("priority");
CREATE INDEX "CustomerIntelligence_score_idx" ON "CustomerIntelligence"("score");
CREATE INDEX "CustomerIntelligence_intent_idx" ON "CustomerIntelligence"("intent");
