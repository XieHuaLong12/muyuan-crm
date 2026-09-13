-- SQLite cannot relax NOT NULL in place. Copy every existing column verbatim.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
 "id" TEXT NOT NULL PRIMARY KEY,"name" TEXT NOT NULL,"companyName" TEXT NOT NULL DEFAULT '',"country" TEXT NOT NULL DEFAULT '',"countryCode" TEXT NOT NULL DEFAULT '',"city" TEXT NOT NULL DEFAULT '',"phone" TEXT NOT NULL DEFAULT '',"whatsapp" TEXT NOT NULL DEFAULT '',"email" TEXT NOT NULL DEFAULT '',"source" TEXT NOT NULL DEFAULT 'OTHER',"sourceDetail" TEXT NOT NULL DEFAULT '',"language" TEXT NOT NULL DEFAULT '',"productInterest" TEXT NOT NULL DEFAULT '',"productModel" TEXT NOT NULL DEFAULT '',"purchaseType" TEXT NOT NULL DEFAULT 'OTHER',"quantity" INTEGER DEFAULT 0,"budget" DECIMAL NOT NULL DEFAULT 0,"estimatedOrderValue" DECIMAL NOT NULL DEFAULT 0,"currency" TEXT NOT NULL DEFAULT 'CNY',"purchaseTimeline" TEXT NOT NULL DEFAULT '',"shippingCountry" TEXT NOT NULL DEFAULT '',"shippingCity" TEXT NOT NULL DEFAULT '',"shippingPostalCode" TEXT NOT NULL DEFAULT '',"stage" TEXT NOT NULL DEFAULT 'NEW',"isQualified" BOOLEAN,"invalidReason" TEXT NOT NULL DEFAULT '',"ownerId" TEXT NOT NULL,"contactedAt" DATETIME,"firstReplyAt" DATETIME,"needsConfirmedAt" DATETIME,"quotedAt" DATETIME,"quotedAmount" DECIMAL NOT NULL DEFAULT 0,"wonAt" DATETIME,"lostAt" DATETIME,"lastFollowUpAt" DATETIME,"nextFollowUpAt" DATETIME,"notes" TEXT NOT NULL DEFAULT '',"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"inquiryAt" DATETIME,"updatedAt" DATETIME NOT NULL,"deletedAt" DATETIME,
 CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("id","name","companyName","country","countryCode","city","phone","whatsapp","email","source","sourceDetail","language","productInterest","productModel","purchaseType","quantity","budget","estimatedOrderValue","currency","purchaseTimeline","shippingCountry","shippingCity","shippingPostalCode","stage","isQualified","invalidReason","ownerId","contactedAt","firstReplyAt","needsConfirmedAt","quotedAt","quotedAmount","wonAt","lostAt","lastFollowUpAt","nextFollowUpAt","notes","createdAt","inquiryAt","updatedAt","deletedAt")
 SELECT "id","name","companyName","country","countryCode","city","phone","whatsapp","email","source","sourceDetail","language","productInterest","productModel","purchaseType","quantity","budget","estimatedOrderValue","currency","purchaseTimeline","shippingCountry","shippingCity","shippingPostalCode","stage","isQualified","invalidReason","ownerId","contactedAt","firstReplyAt","needsConfirmedAt","quotedAt","quotedAmount","wonAt","lostAt","lastFollowUpAt","nextFollowUpAt","notes","createdAt","inquiryAt","updatedAt","deletedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_stage_idx" ON "Customer"("stage");
CREATE INDEX "Customer_source_idx" ON "Customer"("source");
CREATE INDEX "Customer_country_idx" ON "Customer"("country");
CREATE INDEX "Customer_ownerId_idx" ON "Customer"("ownerId");
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");
CREATE INDEX "Customer_inquiryAt_idx" ON "Customer"("inquiryAt");
CREATE INDEX "Customer_nextFollowUpAt_idx" ON "Customer"("nextFollowUpAt");
CREATE INDEX "Customer_isQualified_idx" ON "Customer"("isQualified");
CREATE INDEX "Customer_email_idx" ON "Customer"("email");
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");
CREATE INDEX "Customer_whatsapp_idx" ON "Customer"("whatsapp");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
CREATE TABLE "LeadSubmission" ("id" TEXT NOT NULL PRIMARY KEY,"customerId" TEXT NOT NULL,"eventKey" TEXT NOT NULL,"leadId" TEXT NOT NULL DEFAULT '',"ordinal" INTEGER NOT NULL,"occurredAt" DATETIME NOT NULL,"values" TEXT NOT NULL,"raw" TEXT NOT NULL,"filename" TEXT NOT NULL,"fileHash" TEXT NOT NULL,"translationPending" TEXT NOT NULL DEFAULT '[]',"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "LeadSubmission_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "LeadSubmission_eventKey_key" ON "LeadSubmission"("eventKey");
CREATE UNIQUE INDEX "LeadSubmission_customerId_ordinal_key" ON "LeadSubmission"("customerId","ordinal");
CREATE INDEX "LeadSubmission_customerId_occurredAt_idx" ON "LeadSubmission"("customerId","occurredAt");
CREATE TABLE "MetaImportRun" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL,"result" TEXT NOT NULL,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "TranslationSetting" ("id" TEXT NOT NULL PRIMARY KEY DEFAULT 'meta',"endpoint" TEXT NOT NULL DEFAULT '',"encryptedKey" TEXT NOT NULL DEFAULT '');
