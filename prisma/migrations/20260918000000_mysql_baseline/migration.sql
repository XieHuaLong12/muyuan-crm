-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'SALES',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL DEFAULT '',
    `country` VARCHAR(191) NOT NULL DEFAULT '',
    `countryCode` VARCHAR(191) NOT NULL DEFAULT '',
    `city` VARCHAR(191) NOT NULL DEFAULT '',
    `phone` VARCHAR(191) NOT NULL DEFAULT '',
    `whatsapp` VARCHAR(191) NOT NULL DEFAULT '',
    `whatsappNormalized` VARCHAR(191) NOT NULL DEFAULT '',
    `waId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL DEFAULT '',
    `source` VARCHAR(191) NOT NULL DEFAULT 'OTHER',
    `sourceDetail` VARCHAR(191) NOT NULL DEFAULT '',
    `language` VARCHAR(191) NOT NULL DEFAULT '',
    `productInterest` VARCHAR(191) NOT NULL DEFAULT '',
    `productModel` VARCHAR(191) NOT NULL DEFAULT '',
    `purchaseType` VARCHAR(191) NOT NULL DEFAULT 'OTHER',
    `quantity` INTEGER NULL DEFAULT 0,
    `budget` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `estimatedOrderValue` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY',
    `purchaseTimeline` VARCHAR(191) NOT NULL DEFAULT '',
    `shippingCountry` VARCHAR(191) NOT NULL DEFAULT '',
    `shippingCity` VARCHAR(191) NOT NULL DEFAULT '',
    `shippingPostalCode` VARCHAR(191) NOT NULL DEFAULT '',
    `stage` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    `isQualified` BOOLEAN NULL,
    `invalidReason` VARCHAR(191) NOT NULL DEFAULT '',
    `ownerId` VARCHAR(191) NOT NULL,
    `contactedAt` DATETIME(3) NULL,
    `firstReplyAt` DATETIME(3) NULL,
    `needsConfirmedAt` DATETIME(3) NULL,
    `quotedAt` DATETIME(3) NULL,
    `quotedAmount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `wonAt` DATETIME(3) NULL,
    `lostAt` DATETIME(3) NULL,
    `lastFollowUpAt` DATETIME(3) NULL,
    `nextFollowUpAt` DATETIME(3) NULL,
    `aiScore` INTEGER NOT NULL DEFAULT 0,
    `aiPriority` VARCHAR(191) NOT NULL DEFAULT 'UNRANKED',
    `aiIntent` VARCHAR(191) NOT NULL DEFAULT 'UNKNOWN',
    `aiSummary` VARCHAR(191) NOT NULL DEFAULT '',
    `aiNextAction` VARCHAR(191) NOT NULL DEFAULT '',
    `aiReason` VARCHAR(191) NOT NULL DEFAULT '',
    `aiRisk` VARCHAR(191) NOT NULL DEFAULT '',
    `aiLastAnalyzedAt` DATETIME(3) NULL,
    `lastWhatsAppAt` DATETIME(3) NULL,
    `lastInboundAt` DATETIME(3) NULL,
    `lastOutboundAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `inquiryAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Customer_stage_idx`(`stage`),
    INDEX `Customer_source_idx`(`source`),
    INDEX `Customer_country_idx`(`country`),
    INDEX `Customer_ownerId_idx`(`ownerId`),
    INDEX `Customer_createdAt_idx`(`createdAt`),
    INDEX `Customer_inquiryAt_idx`(`inquiryAt`),
    INDEX `Customer_nextFollowUpAt_idx`(`nextFollowUpAt`),
    INDEX `Customer_isQualified_idx`(`isQualified`),
    INDEX `Customer_email_idx`(`email`),
    INDEX `Customer_phone_idx`(`phone`),
    INDEX `Customer_whatsapp_idx`(`whatsapp`),
    INDEX `Customer_whatsappNormalized_idx`(`whatsappNormalized`),
    INDEX `Customer_waId_idx`(`waId`),
    INDEX `Customer_aiScore_idx`(`aiScore`),
    INDEX `Customer_aiPriority_idx`(`aiPriority`),
    INDEX `Customer_lastWhatsAppAt_idx`(`lastWhatsAppAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FollowUp` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `followUpAt` DATETIME(3) NOT NULL,
    `nextFollowUpAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FollowUp_customerId_followUpAt_idx`(`customerId`, `followUpAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StageHistory` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `fromStage` VARCHAR(191) NULL,
    `toStage` VARCHAR(191) NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `changedBy` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NOT NULL DEFAULT '',

    INDEX `StageHistory_customerId_changedAt_idx`(`customerId`, `changedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Deal` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NOT NULL DEFAULT '',
    `dealAmount` DECIMAL(65, 30) NOT NULL,
    `productCost` DECIMAL(65, 30) NOT NULL,
    `grossProfit` DECIMAL(65, 30) NOT NULL,
    `grossMargin` DECIMAL(65, 30) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY',
    `product` VARCHAR(191) NOT NULL DEFAULT '',
    `productModel` VARCHAR(191) NOT NULL DEFAULT '',
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `notes` VARCHAR(191) NOT NULL DEFAULT '',
    `dealDate` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Deal_dealDate_idx`(`dealDate`),
    INDEX `Deal_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesTarget` (
    `id` VARCHAR(191) NOT NULL,
    `periodKey` VARCHAR(191) NOT NULL,
    `periodType` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NULL,
    `week` INTEGER NULL,
    `targetRevenue` DECIMAL(65, 30) NOT NULL,
    `manual` BOOLEAN NOT NULL DEFAULT false,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesTarget_periodKey_key`(`periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'system',
    `companyName` VARCHAR(191) NOT NULL DEFAULT '木远家具贸易',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Shanghai',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL DEFAULT '',
    `ordinal` INTEGER NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `values` LONGTEXT NOT NULL,
    `raw` LONGTEXT NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `fileHash` VARCHAR(191) NOT NULL,
    `translationPending` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LeadSubmission_eventKey_key`(`eventKey`),
    INDEX `LeadSubmission_customerId_occurredAt_idx`(`customerId`, `occurredAt`),
    UNIQUE INDEX `LeadSubmission_customerId_ordinal_key`(`customerId`, `ordinal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppMessage` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `waMessageId` VARCHAR(191) NOT NULL,
    `waId` VARCHAR(191) NOT NULL DEFAULT '',
    `direction` VARCHAR(191) NOT NULL,
    `messageType` VARCHAR(191) NOT NULL DEFAULT 'TEXT',
    `text` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT '',
    `sentAt` DATETIME(3) NOT NULL,
    `raw` LONGTEXT NOT NULL,
    `aiProcessedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WhatsAppMessage_waMessageId_key`(`waMessageId`),
    INDEX `WhatsAppMessage_customerId_sentAt_idx`(`customerId`, `sentAt`),
    INDEX `WhatsAppMessage_waId_idx`(`waId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerIntelligence` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'UNRANKED',
    `intent` VARCHAR(191) NOT NULL DEFAULT 'UNKNOWN',
    `customerType` VARCHAR(191) NOT NULL DEFAULT 'UNKNOWN',
    `productsJson` TEXT NOT NULL,
    `quantity` INTEGER NULL,
    `currentNeed` VARCHAR(191) NOT NULL DEFAULT '',
    `mainObjection` VARCHAR(191) NOT NULL DEFAULT '',
    `suggestedStage` VARCHAR(191) NOT NULL DEFAULT '',
    `nextAction` VARCHAR(191) NOT NULL DEFAULT '',
    `reason` VARCHAR(191) NOT NULL DEFAULT '',
    `risk` VARCHAR(191) NOT NULL DEFAULT '',
    `confidence` INTEGER NOT NULL DEFAULT 0,
    `lastMessageAt` DATETIME(3) NULL,
    `analyzedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerIntelligence_customerId_key`(`customerId`),
    INDEX `CustomerIntelligence_priority_idx`(`priority`),
    INDEX `CustomerIntelligence_score_idx`(`score`),
    INDEX `CustomerIntelligence_intent_idx`(`intent`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MetaImportRun` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `result` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TranslationSetting` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'meta',
    `endpoint` VARCHAR(191) NOT NULL DEFAULT '',
    `encryptedKey` VARCHAR(191) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppIntegration` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'primary',
    `status` VARCHAR(191) NOT NULL DEFAULT 'DISCONNECTED',
    `connectionMode` VARCHAR(191) NOT NULL DEFAULT 'COEXISTENCE',
    `businessId` VARCHAR(191) NOT NULL DEFAULT '',
    `wabaId` VARCHAR(191) NOT NULL DEFAULT '',
    `phoneNumberId` VARCHAR(191) NOT NULL DEFAULT '',
    `displayPhoneNumber` VARCHAR(191) NOT NULL DEFAULT '',
    `verifiedName` VARCHAR(191) NOT NULL DEFAULT '',
    `encryptedAccessToken` LONGTEXT NOT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `scopes` TEXT NOT NULL,
    `subscribedAt` DATETIME(3) NULL,
    `connectedAt` DATETIME(3) NULL,
    `lastVerifiedAt` DATETIME(3) NULL,
    `lastError` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppIntegration_wabaId_idx`(`wabaId`),
    INDEX `WhatsAppIntegration_phoneNumberId_idx`(`phoneNumberId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FollowUp` ADD CONSTRAINT `FollowUp_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StageHistory` ADD CONSTRAINT `StageHistory_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadSubmission` ADD CONSTRAINT `LeadSubmission_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppMessage` ADD CONSTRAINT `WhatsAppMessage_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerIntelligence` ADD CONSTRAINT `CustomerIntelligence_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

