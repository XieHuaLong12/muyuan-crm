-- CreateTable
CREATE TABLE `RadarReply` (
    `id` VARCHAR(191) NOT NULL,
    `mailboxId` VARCHAR(191) NOT NULL,
    `providerMessageId` VARCHAR(32) NOT NULL,
    `threadId` VARCHAR(32) NOT NULL DEFAULT '',
    `messageId` VARCHAR(255) NOT NULL DEFAULT '',
    `prospectId` VARCHAR(191) NOT NULL,
    `sequenceId` VARCHAR(191) NULL,
    `sendId` VARCHAR(191) NULL,
    `matchedBy` VARCHAR(8) NOT NULL,
    `fromAddress` VARCHAR(191) NOT NULL,
    `fromName` VARCHAR(191) NOT NULL DEFAULT '',
    `subject` VARCHAR(300) NOT NULL DEFAULT '',
    `receivedAt` DATETIME(3) NOT NULL,
    `rawText` MEDIUMTEXT NOT NULL,
    `text` TEXT NOT NULL,
    `screen` VARCHAR(12) NOT NULL,
    `aiCategory` VARCHAR(16) NOT NULL DEFAULT '',
    `category` VARCHAR(16) NOT NULL DEFAULT '',
    `valid` BOOLEAN NULL,
    `confidence` DECIMAL(3, 2) NULL,
    `summary` VARCHAR(500) NOT NULL DEFAULT '',
    `intent` VARCHAR(8) NOT NULL DEFAULT '',
    `extracted` JSON NULL,
    `returnDate` DATETIME(3) NULL,
    `complaint` BOOLEAN NOT NULL DEFAULT false,
    `aiRaw` JSON NULL,
    `analyzedAt` DATETIME(3) NULL,
    `analyzeAttempts` INTEGER NOT NULL DEFAULT 0,
    `analyzeError` VARCHAR(300) NOT NULL DEFAULT '',
    `reviewStatus` VARCHAR(12) NOT NULL DEFAULT 'NONE',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(300) NOT NULL DEFAULT '',
    `pushStatus` VARCHAR(12) NOT NULL DEFAULT 'NONE',
    `pushAttempts` INTEGER NOT NULL DEFAULT 0,
    `pushError` VARCHAR(300) NOT NULL DEFAULT '',
    `pushedAt` DATETIME(3) NULL,
    `customerId` VARCHAR(191) NULL,
    `sampledAt` DATETIME(3) NULL,
    `sampleVerdict` VARCHAR(8) NOT NULL DEFAULT '',
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RadarReply_prospectId_receivedAt_idx`(`prospectId`, `receivedAt`),
    INDEX `RadarReply_reviewStatus_receivedAt_idx`(`reviewStatus`, `receivedAt`),
    INDEX `RadarReply_pushStatus_idx`(`pushStatus`),
    INDEX `RadarReply_processedAt_idx`(`processedAt`),
    INDEX `RadarReply_messageId_idx`(`messageId`),
    INDEX `RadarReply_customerId_idx`(`customerId`),
    UNIQUE INDEX `RadarReply_mailboxId_providerMessageId_key`(`mailboxId`, `providerMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RadarReply` ADD CONSTRAINT `RadarReply_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `RadarMailbox`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarReply` ADD CONSTRAINT `RadarReply_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `RadarProspect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarReply` ADD CONSTRAINT `RadarReply_sequenceId_fkey` FOREIGN KEY (`sequenceId`) REFERENCES `RadarSequence`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarReply` ADD CONSTRAINT `RadarReply_sendId_fkey` FOREIGN KEY (`sendId`) REFERENCES `RadarSend`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarReply` ADD CONSTRAINT `RadarReply_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

