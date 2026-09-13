-- Preserve existing cohort attribution exactly; createdAt remains the system timestamp.
ALTER TABLE "Customer" ADD COLUMN "inquiryAt" DATETIME;
UPDATE "Customer" SET "inquiryAt" = "createdAt" WHERE "inquiryAt" IS NULL;
CREATE INDEX "Customer_inquiryAt_idx" ON "Customer"("inquiryAt");
