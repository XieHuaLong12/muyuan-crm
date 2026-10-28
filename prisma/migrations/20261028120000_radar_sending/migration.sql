-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `radarLaunchedAt` DATETIME(3) NULL,
    ADD COLUMN `radarPausedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `RadarMailbox` (
    `id` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `fromName` VARCHAR(80) NOT NULL DEFAULT '',
    `signature` VARCHAR(1000) NOT NULL DEFAULT '',
    `provider` VARCHAR(12) NOT NULL DEFAULT 'GMAIL',
    `credential` TEXT NULL,
    `warmupStartedAt` DATETIME(3) NOT NULL,
    `capLevel` INTEGER NOT NULL DEFAULT 0,
    `rampedAt` DATETIME(3) NULL,
    `capOverride` INTEGER NULL,
    `nextSendAt` DATETIME(3) NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    `pausedReason` VARCHAR(300) NOT NULL DEFAULT '',
    `pausedAt` DATETIME(3) NULL,
    `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    `historyId` VARCHAR(32) NULL,
    `lastPolledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RadarMailbox_address_key`(`address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RadarTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(16) NOT NULL,
    `language` VARCHAR(2) NOT NULL,
    `step` INTEGER NOT NULL,
    `version` VARCHAR(4) NOT NULL,
    `variant` VARCHAR(8) NOT NULL DEFAULT 'STANDARD',
    `subject` VARCHAR(200) NOT NULL DEFAULT '',
    `body` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'TESTING',
    `versionNote` VARCHAR(300) NOT NULL DEFAULT '',
    `firstSentAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RadarTemplate_code_key`(`code`),
    INDEX `RadarTemplate_language_step_variant_status_idx`(`language`, `step`, `variant`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RadarSequence` (
    `id` VARCHAR(191) NOT NULL,
    `prospectId` VARCHAR(191) NOT NULL,
    `emailId` VARCHAR(191) NOT NULL,
    `mailboxId` VARCHAR(191) NULL,
    `language` VARCHAR(2) NOT NULL,
    `variant` VARCHAR(8) NOT NULL DEFAULT 'STANDARD',
    `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    `activeDomain` VARCHAR(191) NULL,
    `threadId` VARCHAR(32) NULL,
    `messageIds` JSON NULL,
    `needsReview` BOOLEAN NOT NULL DEFAULT false,
    `enqueuedById` VARCHAR(191) NOT NULL,
    `enqueuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resumeAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `endReason` VARCHAR(32) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RadarSequence_activeDomain_key`(`activeDomain`),
    INDEX `RadarSequence_status_idx`(`status`),
    INDEX `RadarSequence_prospectId_idx`(`prospectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RadarSend` (
    `id` VARCHAR(191) NOT NULL,
    `sequenceId` VARCHAR(191) NOT NULL,
    `step` INTEGER NOT NULL,
    `prospectId` VARCHAR(191) NOT NULL,
    `emailId` VARCHAR(191) NOT NULL,
    `toAddress` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NULL,
    `templateCode` VARCHAR(16) NOT NULL DEFAULT '',
    `subject` VARCHAR(300) NOT NULL DEFAULT '',
    `body` TEXT NOT NULL,
    `opening` VARCHAR(500) NOT NULL DEFAULT '',
    `openingSource` VARCHAR(8) NOT NULL DEFAULT '',
    `edited` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(12) NOT NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `plannedAt` DATETIME(3) NULL,
    `mailboxId` VARCHAR(191) NULL,
    `pinnedAt` DATETIME(3) NULL,
    `risky` BOOLEAN NOT NULL DEFAULT false,
    `grade` VARCHAR(1) NOT NULL DEFAULT '',
    `score` INTEGER NOT NULL DEFAULT 0,
    `sentAt` DATETIME(3) NULL,
    `providerMessageId` VARCHAR(32) NULL,
    `messageId` VARCHAR(255) NULL,
    `threadId` VARCHAR(32) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NOT NULL DEFAULT '',
    `cancelReason` VARCHAR(24) NOT NULL DEFAULT '',
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RadarSend_status_plannedAt_idx`(`status`, `plannedAt`),
    INDEX `RadarSend_status_dueAt_idx`(`status`, `dueAt`),
    INDEX `RadarSend_mailboxId_sentAt_idx`(`mailboxId`, `sentAt`),
    INDEX `RadarSend_templateId_status_idx`(`templateId`, `status`),
    INDEX `RadarSend_prospectId_idx`(`prospectId`),
    INDEX `RadarSend_messageId_idx`(`messageId`),
    INDEX `RadarSend_threadId_idx`(`threadId`),
    UNIQUE INDEX `RadarSend_sequenceId_step_key`(`sequenceId`, `step`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RadarSuppression` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(8) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(16) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `note` VARCHAR(300) NOT NULL DEFAULT '',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RadarSuppression_value_idx`(`value`),
    UNIQUE INDEX `RadarSuppression_scope_value_reason_key`(`scope`, `value`, `reason`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RadarSequence` ADD CONSTRAINT `RadarSequence_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `RadarProspect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarSequence` ADD CONSTRAINT `RadarSequence_emailId_fkey` FOREIGN KEY (`emailId`) REFERENCES `RadarEmail`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarSequence` ADD CONSTRAINT `RadarSequence_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `RadarMailbox`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarSend` ADD CONSTRAINT `RadarSend_sequenceId_fkey` FOREIGN KEY (`sequenceId`) REFERENCES `RadarSequence`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarSend` ADD CONSTRAINT `RadarSend_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `RadarProspect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarSend` ADD CONSTRAINT `RadarSend_emailId_fkey` FOREIGN KEY (`emailId`) REFERENCES `RadarEmail`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarSend` ADD CONSTRAINT `RadarSend_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `RadarTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarSend` ADD CONSTRAINT `RadarSend_mailboxId_fkey` FOREIGN KEY (`mailboxId`) REFERENCES `RadarMailbox`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

