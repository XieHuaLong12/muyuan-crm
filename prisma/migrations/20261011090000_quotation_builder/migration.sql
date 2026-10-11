-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `eurCnyRate` DECIMAL(10, 4) NULL;

-- AlterTable
ALTER TABLE `Quotation` ADD COLUMN `destination` VARCHAR(120) NOT NULL DEFAULT '',
    ADD COLUMN `documentJson` TEXT NULL,
    ADD COLUMN `freightAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `freightRateId` VARCHAR(191) NULL,
    ADD COLUMN `language` VARCHAR(4) NOT NULL DEFAULT 'en',
    ADD COLUMN `otherAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `quoteDate` DATETIME(3) NULL,
    ADD COLUMN `subtotalAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `totalAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `totalCbm` DECIMAL(10, 4) NULL,
    ADD COLUMN `totalGrossWeightKg` DECIMAL(12, 2) NULL,
    ADD COLUMN `totalQuantity` INTEGER NULL,
    ADD COLUMN `validUntil` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `QuotationItem` (
    `id` VARCHAR(191) NOT NULL,
    `quotationId` VARCHAR(191) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `productId` VARCHAR(191) NULL,
    `variantId` VARCHAR(191) NULL,
    `model` VARCHAR(80) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `dimensions` VARCHAR(200) NOT NULL DEFAULT '',
    `material` VARCHAR(400) NOT NULL DEFAULT '',
    `packing` VARCHAR(300) NOT NULL DEFAULT '',
    `unit` VARCHAR(20) NOT NULL DEFAULT '',
    `imageKey` VARCHAR(191) NULL,
    `note` VARCHAR(300) NOT NULL DEFAULT '',
    `quantity` INTEGER NOT NULL,
    `cbm` DECIMAL(8, 4) NOT NULL DEFAULT 0,
    `grossWeightKg` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `unitPrice` DECIMAL(14, 2) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `listPrice` DECIMAL(14, 2) NULL,
    `priceSource` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `QuotationItem_quotationId_sort_idx`(`quotationId`, `sort`),
    INDEX `QuotationItem_variantId_idx`(`variantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FreightRate` (
    `id` VARCHAR(191) NOT NULL,
    `country` VARCHAR(80) NOT NULL,
    `port` VARCHAR(120) NOT NULL DEFAULT '',
    `mode` VARCHAR(16) NOT NULL DEFAULT 'SEA',
    `incoterm` VARCHAR(8) NOT NULL DEFAULT 'DDP',
    `basis` VARCHAR(16) NOT NULL,
    `rate` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `volumetricKgPerCbm` INTEGER NULL,
    `minChargeQty` DECIMAL(10, 2) NULL,
    `transitDays` VARCHAR(40) NOT NULL DEFAULT '',
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FreightRate_status_country_idx`(`status`, `country`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuoteTemplate` (
    `language` VARCHAR(4) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `companyLine` VARCHAR(300) NOT NULL,
    `contactLine` VARCHAR(400) NOT NULL,
    `paymentTerms` VARCHAR(400) NOT NULL,
    `leadTime` VARCHAR(400) NOT NULL,
    `moq` VARCHAR(400) NOT NULL,
    `packing` VARCHAR(400) NOT NULL,
    `warranty` VARCHAR(400) NOT NULL,
    `priceBasis` VARCHAR(400) NOT NULL,
    `notes` TEXT NOT NULL,
    `footer` VARCHAR(200) NOT NULL,
    `preparedByRole` VARCHAR(60) NOT NULL,
    `unitLabel` VARCHAR(20) NOT NULL,
    `validDays` INTEGER NOT NULL DEFAULT 15,
    `updatedBy` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`language`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Quotation_createdAt_idx` ON `Quotation`(`createdAt`);

-- CreateIndex
CREATE INDEX `Quotation_freightRateId_idx` ON `Quotation`(`freightRateId`);

-- AddForeignKey
ALTER TABLE `Quotation` ADD CONSTRAINT `Quotation_freightRateId_fkey` FOREIGN KEY (`freightRateId`) REFERENCES `FreightRate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuotationItem` ADD CONSTRAINT `QuotationItem_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `Quotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

