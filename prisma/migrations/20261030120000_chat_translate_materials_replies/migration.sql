-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `autoTranslate` BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX `WhatsAppMessage_sentById_sentAt_idx` ON `WhatsAppMessage`(`sentById`, `sentAt`);

-- CreateTable
CREATE TABLE `MessageTranslation` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `text` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MessageTranslation_messageId_key`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesMaterial` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `category` VARCHAR(12) NOT NULL DEFAULT 'CATALOG',
    `language` VARCHAR(4) NOT NULL DEFAULT '',
    `productLine` VARCHAR(40) NOT NULL DEFAULT '',
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesMaterial_storageKey_key`(`storageKey`),
    INDEX `SalesMaterial_deletedAt_category_idx`(`deletedAt`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuickReply` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `title` VARCHAR(60) NOT NULL,
    `category` VARCHAR(12) NOT NULL DEFAULT 'OTHER',
    `zh` TEXT NOT NULL,
    `bodies` JSON NOT NULL,
    `useCount` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QuickReply_ownerId_deletedAt_idx`(`ownerId`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MessageTranslation` ADD CONSTRAINT `MessageTranslation_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `WhatsAppMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
