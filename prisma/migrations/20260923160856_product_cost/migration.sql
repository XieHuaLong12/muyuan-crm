-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `usdCnyRate` DECIMAL(10, 4) NOT NULL DEFAULT 6.70;

-- CreateTable
CREATE TABLE `ProductCost` (
    `id` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'CNY',
    `factoryCost` DECIMAL(14, 2) NULL,
    `purchaseCost` DECIMAL(14, 2) NULL,
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `note` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductCost_variantId_status_idx`(`variantId`, `status`),
    INDEX `ProductCost_effectiveFrom_idx`(`effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductCost` ADD CONSTRAINT `ProductCost_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

