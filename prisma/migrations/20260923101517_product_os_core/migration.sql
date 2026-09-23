-- CreateTable
CREATE TABLE `ProductCategory` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `nameCn` VARCHAR(191) NOT NULL DEFAULT '',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductCategory_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductSeries` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `nameCn` VARCHAR(191) NOT NULL DEFAULT '',
    `descriptionEn` TEXT NOT NULL,
    `descriptionCn` TEXT NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductSeries_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `nameCn` VARCHAR(191) NOT NULL DEFAULT '',
    `categoryId` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `lengthLabel` VARCHAR(191) NOT NULL DEFAULT '',
    `isModular` BOOLEAN NOT NULL DEFAULT false,
    `isSofaBed` BOOLEAN NOT NULL DEFAULT false,
    `seatCount` INTEGER NULL,
    `pillowCount` INTEGER NULL,
    `backrestCount` INTEGER NULL,
    `leadTimeDays` INTEGER NOT NULL DEFAULT 15,
    `qaMonths` INTEGER NOT NULL DEFAULT 12,
    `descriptionEn` TEXT NOT NULL,
    `descriptionCn` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Product_model_key`(`model`),
    INDEX `Product_categoryId_status_idx`(`categoryId`, `status`),
    INDEX `Product_seriesId_idx`(`seriesId`),
    INDEX `Product_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductVariant` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `variantType` VARCHAR(191) NOT NULL DEFAULT 'CONFIGURATION',
    `labelEn` VARCHAR(191) NOT NULL DEFAULT '',
    `labelCn` VARCHAR(191) NOT NULL DEFAULT '',
    `lengthCm` INTEGER NULL,
    `widthCm` INTEGER NULL,
    `heightCm` INTEGER NULL,
    `secondaryLabelEn` VARCHAR(191) NOT NULL DEFAULT '',
    `secondaryLabelCn` VARCHAR(191) NOT NULL DEFAULT '',
    `secondaryLengthCm` INTEGER NULL,
    `secondaryWidthCm` INTEGER NULL,
    `secondaryHeightCm` INTEGER NULL,
    `bedSizeCm` VARCHAR(191) NOT NULL DEFAULT '',
    `packingRaw` VARCHAR(191) NOT NULL DEFAULT '',
    `cartonCount` INTEGER NOT NULL DEFAULT 1,
    `cbm` DECIMAL(8, 4) NOT NULL DEFAULT 0,
    `cbmComputed` DECIMAL(8, 4) NULL,
    `grossWeightKg` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `grossWeightRaw` VARCHAR(191) NOT NULL DEFAULT '',
    `needsReview` BOOLEAN NOT NULL DEFAULT false,
    `reviewNote` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductVariant_sku_key`(`sku`),
    INDEX `ProductVariant_productId_status_idx`(`productId`, `status`),
    INDEX `ProductVariant_deletedAt_idx`(`deletedAt`),
    INDEX `ProductVariant_needsReview_idx`(`needsReview`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PackingCarton` (
    `id` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL DEFAULT '',
    `lengthCm` INTEGER NOT NULL,
    `widthCm` INTEGER NOT NULL,
    `heightCm` INTEGER NOT NULL,
    `cartonCount` INTEGER NOT NULL DEFAULT 1,
    `piecesPerCarton` INTEGER NOT NULL DEFAULT 1,
    `grossWeightKg` DECIMAL(8, 2) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    INDEX `PackingCarton_variantId_sort_idx`(`variantId`, `sort`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductMaterial` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `nameCn` VARCHAR(191) NOT NULL DEFAULT '',
    `specEn` VARCHAR(191) NOT NULL DEFAULT '',
    `sort` INTEGER NOT NULL DEFAULT 0,

    INDEX `ProductMaterial_productId_role_idx`(`productId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductOption` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL DEFAULT '',
    `nameEn` VARCHAR(191) NOT NULL,
    `nameCn` VARCHAR(191) NOT NULL DEFAULT '',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `sort` INTEGER NOT NULL DEFAULT 0,

    INDEX `ProductOption_productId_kind_idx`(`productId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductMoq` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `channelLabelCn` VARCHAR(191) NOT NULL DEFAULT '',
    `minQty` INTEGER NOT NULL,
    `note` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductMoq_channel_idx`(`channel`),
    UNIQUE INDEX `ProductMoq_productId_channel_key`(`productId`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductPrice` (
    `id` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NOT NULL,
    `priceListKey` VARCHAR(191) NOT NULL DEFAULT 'LVANJU-2026',
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `incoterm` VARCHAR(191) NOT NULL DEFAULT 'FOB',
    `includesFreight` BOOLEAN NOT NULL DEFAULT false,
    `customerTier` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `minQty` INTEGER NOT NULL DEFAULT 1,
    `maxQty` INTEGER NULL,
    `unitPrice` DECIMAL(14, 2) NOT NULL,
    `cost` DECIMAL(14, 2) NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductPrice_variantId_status_idx`(`variantId`, `status`),
    INDEX `ProductPrice_effectiveFrom_idx`(`effectiveFrom`),
    UNIQUE INDEX `ProductPrice_variantId_priceListKey_currency_incoterm_custom_key`(`variantId`, `priceListKey`, `currency`, `incoterm`, `customerTier`, `minQty`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductMedia` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'GALLERY',
    `storageKey` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `size` INTEGER NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductMedia_storageKey_key`(`storageKey`),
    INDEX `ProductMedia_productId_role_idx`(`productId`, `role`),
    INDEX `ProductMedia_variantId_idx`(`variantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductAiProfile` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `sellingPointsJson` TEXT NOT NULL,
    `advantagesJson` TEXT NOT NULL,
    `useCasesJson` TEXT NOT NULL,
    `bestCustomerJson` TEXT NOT NULL,
    `recommendedMarketJson` TEXT NOT NULL,
    `keywordsJson` TEXT NOT NULL,
    `searchText` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductAiProfile_productId_key`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ProductCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `ProductSeries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductVariant` ADD CONSTRAINT `ProductVariant_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackingCarton` ADD CONSTRAINT `PackingCarton_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductMaterial` ADD CONSTRAINT `ProductMaterial_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductOption` ADD CONSTRAINT `ProductOption_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductMoq` ADD CONSTRAINT `ProductMoq_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductPrice` ADD CONSTRAINT `ProductPrice_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductMedia` ADD CONSTRAINT `ProductMedia_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductMedia` ADD CONSTRAINT `ProductMedia_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `ProductVariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductAiProfile` ADD CONSTRAINT `ProductAiProfile_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

