-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `radarConfig` JSON NULL;

-- CreateTable
CREATE TABLE `RadarSearch` (
    `id` VARCHAR(191) NOT NULL,
    `country` VARCHAR(2) NOT NULL,
    `city` VARCHAR(120) NOT NULL,
    `keyword` VARCHAR(120) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastRunAt` DATETIME(3) NULL,
    `lastFound` INTEGER NOT NULL DEFAULT 0,
    `lastNew` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RadarSearch_active_lastRunAt_idx`(`active`, `lastRunAt`),
    UNIQUE INDEX `RadarSearch_country_city_keyword_key`(`country`, `city`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RadarProspect` (
    `id` VARCHAR(191) NOT NULL,
    `placeKey` VARCHAR(191) NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `nameCityKey` VARCHAR(191) NOT NULL,
    `country` VARCHAR(2) NOT NULL,
    `city` VARCHAR(120) NOT NULL DEFAULT '',
    `timezone` VARCHAR(40) NOT NULL,
    `address` VARCHAR(500) NOT NULL DEFAULT '',
    `website` VARCHAR(500) NOT NULL DEFAULT '',
    `domain` VARCHAR(191) NOT NULL DEFAULT '',
    `phone` VARCHAR(40) NOT NULL DEFAULT '',
    `phoneE164` VARCHAR(16) NULL,
    `whatsapp` VARCHAR(40) NOT NULL DEFAULT '',
    `socials` JSON NULL,
    `mapsCategory` VARCHAR(200) NOT NULL DEFAULT '',
    `rating` DECIMAL(2, 1) NULL,
    `reviewCount` INTEGER NULL,
    `siteText` TEXT NULL,
    `customerType` VARCHAR(16) NOT NULL DEFAULT '',
    `mainProducts` VARCHAR(500) NOT NULL DEFAULT '',
    `aiReason` VARCHAR(500) NOT NULL DEFAULT '',
    `scoreParts` JSON NULL,
    `score` INTEGER NULL,
    `grade` VARCHAR(1) NOT NULL DEFAULT '',
    `siteFacts` JSON NULL,
    `scoredAt` DATETIME(3) NULL,
    `scoreAttempts` INTEGER NOT NULL DEFAULT 0,
    `scoreError` VARCHAR(300) NOT NULL DEFAULT '',
    `keyword` VARCHAR(120) NOT NULL DEFAULT '',
    `searchId` VARCHAR(191) NULL,
    `discoveredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(16) NOT NULL DEFAULT 'NEW',
    `statusAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `excludedReason` VARCHAR(200) NOT NULL DEFAULT '',
    `notes` VARCHAR(1000) NOT NULL DEFAULT '',
    `customerId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RadarProspect_placeKey_key`(`placeKey`),
    INDEX `RadarProspect_status_grade_score_idx`(`status`, `grade`, `score`),
    INDEX `RadarProspect_country_status_idx`(`country`, `status`),
    INDEX `RadarProspect_domain_idx`(`domain`),
    INDEX `RadarProspect_phoneE164_idx`(`phoneE164`),
    INDEX `RadarProspect_nameCityKey_idx`(`nameCityKey`),
    INDEX `RadarProspect_discoveredAt_idx`(`discoveredAt`),
    INDEX `RadarProspect_scoredAt_idx`(`scoredAt`),
    INDEX `RadarProspect_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RadarEmail` (
    `id` VARCHAR(191) NOT NULL,
    `prospectId` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `source` VARCHAR(8) NOT NULL DEFAULT 'WEBSITE',
    `foundOn` VARCHAR(500) NOT NULL DEFAULT '',
    `verifyStatus` VARCHAR(8) NOT NULL DEFAULT '',
    `verifyDetail` VARCHAR(200) NOT NULL DEFAULT '',
    `verifiedAt` DATETIME(3) NULL,
    `verifyAttempts` INTEGER NOT NULL DEFAULT 0,
    `bouncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RadarEmail_address_idx`(`address`),
    INDEX `RadarEmail_verifyStatus_idx`(`verifyStatus`),
    UNIQUE INDEX `RadarEmail_prospectId_address_key`(`prospectId`, `address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RadarProspect` ADD CONSTRAINT `RadarProspect_searchId_fkey` FOREIGN KEY (`searchId`) REFERENCES `RadarSearch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarProspect` ADD CONSTRAINT `RadarProspect_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RadarEmail` ADD CONSTRAINT `RadarEmail_prospectId_fkey` FOREIGN KEY (`prospectId`) REFERENCES `RadarProspect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

