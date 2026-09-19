-- Preserve existing message bodies: Prisma content maps to the original text column.
ALTER TABLE `Customer` ADD COLUMN `lastContactAt` DATETIME(3) NULL;
ALTER TABLE `WhatsAppMessage`
  MODIFY `waMessageId` VARCHAR(191) NULL,
  ADD COLUMN `requestId` VARCHAR(191) NULL,
  ADD COLUMN `providerMessageId` VARCHAR(191) NULL,
  ADD COLUMN `sender` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
CREATE UNIQUE INDEX `WhatsAppMessage_requestId_key` ON `WhatsAppMessage`(`requestId`);
CREATE UNIQUE INDEX `WhatsAppMessage_providerMessageId_key` ON `WhatsAppMessage`(`providerMessageId`);
UPDATE `WhatsAppMessage` SET `updatedAt` = `createdAt`, `sender` = IF(`direction` = 'INBOUND', `waId`, 'BUSINESS');
UPDATE `Customer` SET `lastContactAt` = `lastWhatsAppAt` WHERE `lastWhatsAppAt` IS NOT NULL;
