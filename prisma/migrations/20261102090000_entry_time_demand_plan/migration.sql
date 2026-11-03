-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `demandScannedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `workEndHour` INTEGER NOT NULL DEFAULT 22,
    ADD COLUMN `workStartHour` INTEGER NOT NULL DEFAULT 8;

-- CreateTable
CREATE TABLE `CustomerDemandField` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `field` VARCHAR(16) NOT NULL,
    `value` VARCHAR(200) NOT NULL,
    `evidence` VARCHAR(500) NOT NULL DEFAULT '',
    `evidenceAt` DATETIME(3) NULL,
    `source` VARCHAR(8) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'SUGGESTED',
    `confirmedById` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomerDemandField_field_status_idx`(`field`, `status`),
    UNIQUE INDEX `CustomerDemandField_customerId_field_key`(`customerId`, `field`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdHourlyMetric` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `adId` VARCHAR(191) NOT NULL,
    `metricDate` DATE NOT NULL,
    `hour` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `spend` DECIMAL(14, 2) NOT NULL,
    `impressions` INTEGER NOT NULL DEFAULT 0,
    `clicks` INTEGER NOT NULL DEFAULT 0,
    `leads` INTEGER NOT NULL DEFAULT 0,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdHourlyMetric_metricDate_idx`(`metricDate`),
    UNIQUE INDEX `AdHourlyMetric_accountId_adId_metricDate_hour_key`(`accountId`, `adId`, `metricDate`, `hour`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanSuggestion` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `country` VARCHAR(100) NOT NULL DEFAULT '',
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `basis` VARCHAR(300) NOT NULL,
    `metric` JSON NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `reviewAt` DATETIME(3) NULL,
    `review` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlanSuggestion_key_key`(`key`),
    INDEX `PlanSuggestion_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CustomerDemandField` ADD CONSTRAINT `CustomerDemandField_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

