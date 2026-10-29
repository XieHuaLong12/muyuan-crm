-- 上架方式：AUTO 资料齐全自动上架 / MANUAL 管理员上下架。已有产品默认手动，状态不变。
-- AlterTable
ALTER TABLE `Product` ADD COLUMN `listingMode` VARCHAR(16) NOT NULL DEFAULT 'MANUAL';

-- 在产品库上传的产品图（1200 × 900 JPEG），每次上传新地址，旧图留给历史报价单。
-- CreateTable
CREATE TABLE `ProductImageFile` (
    `id` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(32) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `size` INTEGER NOT NULL,
    `data` MEDIUMBLOB NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductImageFile_storageKey_key`(`storageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
