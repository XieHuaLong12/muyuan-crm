-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `emailNormalized` VARCHAR(191) NULL,
    ADD COLUMN `phoneE164` VARCHAR(16) NULL,
    ADD COLUMN `stageSource` VARCHAR(16) NOT NULL DEFAULT 'HUMAN';

-- AlterTable
ALTER TABLE `WhatsAppMessage` ADD COLUMN `conversationId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `WhatsAppUnmatchedMessage` ADD COLUMN `canonicalConversationId` VARCHAR(191) NULL,
    ADD COLUMN `provider` VARCHAR(24) NOT NULL DEFAULT 'whatsapp_web';

-- AlterTable
ALTER TABLE `CustomerIntelligence` ADD COLUMN `aiAnalysis` JSON NULL,
    ADD COLUMN `analysisError` TEXT NULL,
    ADD COLUMN `analysisPending` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `humanOverrides` JSON NULL,
    ADD COLUMN `lastAnalyzedMessageAt` DATETIME(3) NULL,
    ADD COLUMN `lastAnalyzedMessageId` VARCHAR(191) NULL,
    ADD COLUMN `nextFollowUpAt` DATETIME(3) NULL,
    ADD COLUMN `summary` TEXT NULL;

-- CreateTable
CREATE TABLE `ContactIdentity` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `normalized` VARCHAR(191) NOT NULL,
    `rawValue` TEXT NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContactIdentity_kind_normalized_idx`(`kind`, `normalized`),
    UNIQUE INDEX `ContactIdentity_customerId_kind_normalized_key`(`customerId`, `kind`, `normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerLeadAttribution` (
    `id` VARCHAR(191) NOT NULL,
    `leadKey` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'UNMATCHED',
    `matchMethod` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `confidence` INTEGER NOT NULL DEFAULT 0,
    `occurredAt` DATETIME(3) NULL,
    `phoneRaw` TEXT NULL,
    `phoneE164` VARCHAR(16) NULL,
    `emailNormalized` VARCHAR(191) NULL,
    `platform` VARCHAR(24) NULL,
    `accountId` VARCHAR(191) NULL,
    `campaignId` VARCHAR(191) NULL,
    `campaignName` TEXT NULL,
    `adsetId` VARCHAR(191) NULL,
    `adsetName` TEXT NULL,
    `adId` VARCHAR(191) NULL,
    `adName` TEXT NULL,
    `creativeId` VARCHAR(191) NULL,
    `creativeName` TEXT NULL,
    `formId` VARCHAR(191) NULL,
    `formName` TEXT NULL,
    `answers` JSON NULL,
    `source` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerLeadAttribution_leadKey_key`(`leadKey`),
    INDEX `CustomerLeadAttribution_customerId_occurredAt_id_idx`(`customerId`, `occurredAt`, `id`),
    INDEX `CustomerLeadAttribution_phoneE164_idx`(`phoneE164`),
    INDEX `CustomerLeadAttribution_leadId_idx`(`leadId`),
    INDEX `CustomerLeadAttribution_campaignId_occurredAt_idx`(`campaignId`, `occurredAt`),
    INDEX `CustomerLeadAttribution_adsetId_occurredAt_idx`(`adsetId`, `occurredAt`),
    INDEX `CustomerLeadAttribution_adId_occurredAt_idx`(`adId`, `occurredAt`),
    INDEX `CustomerLeadAttribution_creativeId_occurredAt_idx`(`creativeId`, `occurredAt`),
    INDEX `CustomerLeadAttribution_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppContact` (
    `id` VARCHAR(191) NOT NULL,
    `identityKey` CHAR(64) NOT NULL,
    `provider` VARCHAR(24) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `peerId` VARCHAR(191) NOT NULL,
    `phoneRaw` TEXT NULL,
    `phoneE164` VARCHAR(16) NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `customerId` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'UNMATCHED',
    `matchMethod` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `confidence` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppContact_identityKey_key`(`identityKey`),
    INDEX `WhatsAppContact_phoneE164_idx`(`phoneE164`),
    INDEX `WhatsAppContact_customerId_idx`(`customerId`),
    INDEX `WhatsAppContact_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppConversation` (
    `id` VARCHAR(191) NOT NULL,
    `identityKey` CHAR(64) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `syncCursor` TEXT NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `lastInboundAt` DATETIME(3) NULL,
    `lastOutboundAt` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppConversation_identityKey_key`(`identityKey`),
    INDEX `WhatsAppConversation_contactId_lastMessageAt_idx`(`contactId`, `lastMessageAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdentityAudit` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(32) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `fromCustomerId` VARCHAR(191) NULL,
    `toCustomerId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `detail` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IdentityAudit_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderAttribution` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(32) NOT NULL DEFAULT 'LAST_META_TOUCH',
    `status` VARCHAR(24) NOT NULL DEFAULT 'UNATTRIBUTED',
    `firstLeadKey` VARCHAR(191) NULL,
    `lastLeadKey` VARCHAR(191) NULL,
    `campaignId` VARCHAR(191) NULL,
    `adsetId` VARCHAR(191) NULL,
    `adId` VARCHAR(191) NULL,
    `creativeId` VARCHAR(191) NULL,
    `snapshot` JSON NOT NULL,
    `lockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OrderAttribution_orderId_key`(`orderId`),
    INDEX `OrderAttribution_campaignId_idx`(`campaignId`),
    INDEX `OrderAttribution_adId_idx`(`adId`),
    INDEX `OrderAttribution_creativeId_idx`(`creativeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdvertisingFeedback` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `eventName` VARCHAR(32) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `leadKey` VARCHAR(191) NULL,
    `eventTime` DATETIME(3) NOT NULL,
    `value` DECIMAL(14, 2) NULL,
    `currency` VARCHAR(3) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'NOT_CONNECTED',
    `payload` JSON NOT NULL,
    `response` JSON NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `processingStartedAt` DATETIME(3) NULL,
    `nextAttemptAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdvertisingFeedback_eventId_key`(`eventId`),
    INDEX `AdvertisingFeedback_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `AdvertisingFeedback_customerId_eventTime_idx`(`customerId`, `eventTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdDimension` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `adId` VARCHAR(191) NOT NULL,
    `adName` TEXT NOT NULL,
    `adsetId` VARCHAR(191) NOT NULL,
    `adsetName` TEXT NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `campaignName` TEXT NOT NULL,
    `creativeId` VARCHAR(191) NULL,
    `creativeName` TEXT NULL,
    `creativeCategory` VARCHAR(32) NULL,
    `syncedAt` DATETIME(3) NULL,

    INDEX `AdDimension_campaignId_idx`(`campaignId`),
    INDEX `AdDimension_adsetId_idx`(`adsetId`),
    INDEX `AdDimension_creativeId_idx`(`creativeId`),
    UNIQUE INDEX `AdDimension_accountId_adId_key`(`accountId`, `adId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdDailyMetric` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `adId` VARCHAR(191) NOT NULL,
    `metricDate` DATE NOT NULL,
    `platform` VARCHAR(24) NOT NULL DEFAULT 'ALL',
    `country` VARCHAR(16) NOT NULL DEFAULT 'ALL',
    `grain` VARCHAR(24) NOT NULL DEFAULT 'AD',
    `currency` VARCHAR(3) NOT NULL,
    `spend` DECIMAL(14, 2) NOT NULL,
    `impressions` INTEGER NOT NULL DEFAULT 0,
    `reach` INTEGER NULL,
    `clicks` INTEGER NOT NULL DEFAULT 0,
    `leads` INTEGER NOT NULL DEFAULT 0,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdDailyMetric_metricDate_grain_idx`(`metricDate`, `grain`),
    INDEX `AdDailyMetric_adId_metricDate_idx`(`adId`, `metricDate`),
    UNIQUE INDEX `AdDailyMetric_accountId_adId_metricDate_grain_platform_count_key`(`accountId`, `adId`, `metricDate`, `grain`, `platform`, `country`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncJob` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(24) NOT NULL,
    `jobType` VARCHAR(32) NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `processed` INTEGER NOT NULL DEFAULT 0,
    `succeeded` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `detail` JSON NULL,

    INDEX `SyncJob_provider_jobType_startedAt_idx`(`provider`, `jobType`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyAdInsight` (
    `id` VARCHAR(191) NOT NULL,
    `reportKey` VARCHAR(191) NOT NULL,
    `reportDate` DATE NOT NULL,
    `timezone` VARCHAR(60) NOT NULL,
    `evidence` JSON NOT NULL,
    `analysis` JSON NOT NULL,
    `model` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DailyAdInsight_reportKey_key`(`reportKey`),
    INDEX `DailyAdInsight_reportDate_idx`(`reportDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Customer_phoneE164_idx` ON `Customer`(`phoneE164`);

-- CreateIndex
CREATE INDEX `Customer_emailNormalized_idx` ON `Customer`(`emailNormalized`);

-- CreateIndex
CREATE INDEX `WhatsAppMessage_conversationId_sentAt_id_idx` ON `WhatsAppMessage`(`conversationId`, `sentAt`, `id`);

-- AddForeignKey
ALTER TABLE `WhatsAppMessage` ADD CONSTRAINT `WhatsAppMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `WhatsAppConversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppUnmatchedMessage` ADD CONSTRAINT `WhatsAppUnmatchedMessage_canonicalConversationId_fkey` FOREIGN KEY (`canonicalConversationId`) REFERENCES `WhatsAppConversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactIdentity` ADD CONSTRAINT `ContactIdentity_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerLeadAttribution` ADD CONSTRAINT `CustomerLeadAttribution_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppContact` ADD CONSTRAINT `WhatsAppContact_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversation` ADD CONSTRAINT `WhatsAppConversation_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `WhatsAppContact`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderAttribution` ADD CONSTRAINT `OrderAttribution_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdvertisingFeedback` ADD CONSTRAINT `AdvertisingFeedback_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdvertisingFeedback` ADD CONSTRAINT `AdvertisingFeedback_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

