-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `whatsappOptInAt` DATETIME(3) NULL,
    ADD COLUMN `whatsappOptInEvidence` TEXT NULL,
    ADD COLUMN `whatsappOptInSource` VARCHAR(24) NULL,
    ADD COLUMN `whatsappOptInStatus` VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN `whatsappOptOutAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `WhatsAppMessage` ADD COLUMN `deliveredAt` DATETIME(3) NULL,
    ADD COLUMN `destinationPhone` VARCHAR(16) NULL,
    ADD COLUMN `failedAt` DATETIME(3) NULL,
    ADD COLUMN `providerAccountId` VARCHAR(191) NULL,
    ADD COLUMN `providerOccurredAt` DATETIME(3) NULL,
    ADD COLUMN `readAt` DATETIME(3) NULL,
    ADD COLUMN `sourcePhone` VARCHAR(16) NULL;

-- AlterTable
ALTER TABLE `WhatsAppConversation` ADD COLUMN `lastCustomerMessageAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `WhatsAppStatusReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `receiptKey` CHAR(64) NOT NULL,
    `provider` VARCHAR(24) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `gsId` VARCHAR(191) NULL,
    `status` VARCHAR(24) NOT NULL,
    `occurredAt` DATETIME(3) NULL,
    `failureCode` VARCHAR(32) NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsAppStatusReceipt_receiptKey_key`(`receiptKey`),
    INDEX `WhatsAppStatusReceipt_provider_accountId_appliedAt_createdAt_idx`(`provider`, `accountId`, `appliedAt`, `createdAt`),
    INDEX `WhatsAppStatusReceipt_messageId_idx`(`messageId`),
    INDEX `WhatsAppStatusReceipt_gsId_idx`(`gsId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Customer_whatsappOptInStatus_idx` ON `Customer`(`whatsappOptInStatus`);

